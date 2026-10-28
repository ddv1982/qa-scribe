import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { checkRustLsp } from './check-rust-typescript-lsp.mjs'
import { prepareRustSdk } from './prepare-rust-typescript-sdk.mjs'

function peer(t, scenario, version = '0.8.0') {
  const root = mkdtempSync(join(tmpdir(), 'rust-lsp-peer-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const name = `@tsc-rs/${process.platform}-${process.arch}`
  const native = join(root, 'node_modules', name)
  const write = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)) }
  write(join(root, 'package.json'), { devDependencies: { 'tsc-rs': version } })
  write(join(root, 'node_modules/tsc-rs/package.json'), { name: 'tsc-rs', version, optionalDependencies: { [name]: version } })
  write(join(native, 'package.json'), { name, version, os: [process.platform], cpu: [process.arch], type: 'commonjs' })
  for (const file of ['lib.d.ts', 'lib.es5.d.ts', 'lib.dom.d.ts', 'lib.esnext.full.d.ts']) write(join(native, 'lib', file), '')
  const executable = join(native, 'lib/tsc')
  write(executable, `#!${process.execPath}
const scenario=${JSON.stringify(scenario)};
const eof={jsonrpc:'2.0',method:'window/logMessage',params:{type:1,message:"error handling method 'exit': EOF"}};
const frame=message=>{const body=JSON.stringify(message);return 'Content-Length: '+Buffer.byteLength(body)+'\\r\\n\\r\\n'+body};
const send=message=>process.stdout.write(frame(message));
const exit=(code,output='')=>process.stdout.write(output,()=>process.exit(code));
let buffer=Buffer.alloc(0),registered=false,pendingShutdown=false;
process.stdin.on('data',data=>{
 buffer=Buffer.concat([buffer,data]);
 for(;;){
  const end=buffer.indexOf('\\r\\n\\r\\n');if(end<0)return;
  const length=Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0,end).toString())[1]);if(buffer.length<end+4+length)return;
  const message=JSON.parse(buffer.subarray(end+4,end+4+length));buffer=buffer.subarray(end+4+length);
  if(message.method==='initialize'){
   if(scenario==='early-close')return exit(0);
   if(scenario==='stdin-failure')require('node:fs').closeSync(0);
   if(scenario==='out-of-order')return exit(0,frame({jsonrpc:'2.0',id:2,result:null}));
   send({jsonrpc:'2.0',id:1,result:{capabilities:{},serverInfo:{name:'fake-peer'}}});
  }
  if(message.method==='initialized'&&scenario==='registration')send({jsonrpc:'2.0',id:'watch',method:'client/registerCapability',params:{registrations:[{id:'one',method:'workspace/didChangeConfiguration'}]}});
  if(message.id==='watch'&&'result' in message){registered=true;if(pendingShutdown)send({jsonrpc:'2.0',id:2,result:null});}
  if(message.method==='shutdown'){
   if(scenario==='no-ack')return exit(0);
   if(scenario==='rpc-error')return exit(17,frame({jsonrpc:'2.0',id:2,error:{code:-32603,message:'broken after initialize'}}));
   if(scenario==='malformed-json')return exit(17,'Content-Length: 1\\r\\n\\r\\n{');
   if(scenario==='malformed-json-after-ack')return exit(17,frame({jsonrpc:'2.0',id:2,result:null})+'Content-Length: 1\\r\\n\\r\\n{');
   if(scenario==='bad-rpc-version')return exit(0,frame({jsonrpc:'1.0',id:2,result:null}));
   if(scenario==='early-eof-log')send(eof);
   if(scenario==='malformed-message')return exit(0,frame({jsonrpc:'2.0',id:2,result:null})+frame(null));
   if(scenario==='duplicate-header')return exit(0,'Content-Length: 2\\r\\nContent-Length: 2\\r\\n\\r\\n{}');
   if(scenario==='registration'&&!registered){pendingShutdown=true;continue;}
   send({jsonrpc:'2.0',id:2,result:null});
   if(scenario==='duplicate-ack')send({jsonrpc:'2.0',id:2,result:null});
  }
  if(message.method==='exit'){
   if(scenario==='truncated')return exit(0,'Content-Length: 80\\r\\n\\r\\n{}');
   if(scenario==='normal-with-eof')return exit(0,frame(eof));
   if(scenario==='error-log')return exit(0,frame({jsonrpc:'2.0',method:'window/logMessage',params:{type:1,message:'unexpected failure'}}));
   if(scenario==='normal-stderr')return process.stderr.write('unexpected failure\\n',()=>exit(0));
   if(scenario==='signal')return process.kill(process.pid,'SIGTERM');
   if(scenario.startsWith('code-'))return exit(Number(scenario.slice(5)));
   if(scenario==='qualified'||scenario==='qualified-code-42'||scenario==='wrong-stderr'||scenario==='extra-error'){
    send(eof);
    if(scenario==='extra-error')send({jsonrpc:'2.0',method:'window/logMessage',params:{type:1,message:'another failure'}});
    return process.stderr.write(scenario==='wrong-stderr'?'context canceled\\nextra\\n':'context canceled\\n',()=>exit(scenario==='qualified-code-42'?42:1));
   }
   if(scenario==='missing-stderr')return exit(1,frame(eof));
   return exit(0);
  }
 }
});
`)
  chmodSync(executable, 0o755)
  prepareRustSdk(root)
  return root
}

for (const scenario of ['normal', 'registration']) test(`successful ordered handshake and exit: ${scenario}`, async t => {
  const result = await checkRustLsp(peer(t, scenario))
  assert.equal(result.outcome, 'NORMAL_EXIT')
  assert.deepEqual(result.stopped, { code: 0, signal: null })
  assert.equal(result.phase, 'exit-sent')
  assert.deepEqual(result.sent.filter(message => message.method).map(message => message.method), ['initialize', 'initialized', 'shutdown', 'exit'])
})

test('only the exact pinned upstream shutdown signature is explicitly qualified', async t => {
  const result = await checkRustLsp(peer(t, 'qualified'))
  assert.equal(result.outcome, 'QUALIFIED_PINNED_0_8_0_SHUTDOWN_EOF')
  assert.deepEqual(result.stopped, { code: 1, signal: null })
  assert.equal(result.stderr, 'context canceled\n')
  assert.match(result.qualification, /not a normal exit/)
})

for (const scenario of ['code-1', 'code-2', 'code-17', 'code-42', 'code-255', 'qualified-code-42', 'wrong-stderr', 'missing-stderr']) test(`rejects nonzero exit or wrong qualification: ${scenario}`, async t => {
  await assert.rejects(checkRustLsp(peer(t, scenario)), error => error.receipt?.outcome === 'FAIL' && /Unexpected Rust LSP exit code or shutdown signature/.test(error.message))
})

test('the exact shutdown signature does not qualify another SDK version', async t => {
  await assert.rejects(checkRustLsp(peer(t, 'qualified', '0.8.1')), /Unexpected Rust LSP exit code or shutdown signature/)
})

for (const [scenario, expected] of [
  ['early-close', /closed before ordered/],
  ['no-ack', /closed before ordered/],
  ['out-of-order', /shutdown response out of order/],
  ['duplicate-ack', /shutdown response out of order/],
  ['rpc-error', /error response/],
  ['malformed-json', /JSON|Unexpected/],
  ['malformed-json-after-ack', /JSON|Unexpected/],
  ['bad-rpc-version', /Malformed Rust LSP JSON-RPC/],
  ['early-eof-log', /Rust LSP error log/],
  ['normal-with-eof', /Unexpected Rust LSP error log on normal exit/],
  ['stdin-failure', /EPIPE|stream|write/i],
  ['malformed-message', /Malformed Rust LSP JSON-RPC/],
  ['duplicate-header', /exactly one Content-Length/],
  ['truncated', /Truncated Rust LSP frame/],
  ['normal-stderr', /Unexpected Rust LSP stderr/],
  ['error-log', /Rust LSP error log: unexpected failure/],
  ['extra-error', /Rust LSP error log: another failure/],
  ['signal', /unexpected signal/],
]) test(`preserves rejection through child close: ${scenario}`, async t => {
  await assert.rejects(checkRustLsp(peer(t, scenario)), error => {
    assert.match(error.message, expected)
    assert.equal(error.receipt.outcome, 'FAIL')
    assert.equal(error.receipt.firstFailure.message, error.message)
    assert.ok(error.receipt.stopped, 'Failure receipt must include the actual closed child')
    if (scenario === 'malformed-json' || scenario === 'rpc-error') assert.equal(error.receipt.firstFailure.phase, 'shutdown-sent')
    return true
  })
})
