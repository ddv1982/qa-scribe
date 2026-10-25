import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ChatState, DraftPatch, FindingPatch, RecordWriteGuard, RefinementProposal, RefinementRequest } from '../bindings'
import { draftFixture, findingFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { editorValue, recordWriteGuard, RecordWriteConflict } from './recordWriteGuards'
import { chatFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const api=getTauriMock()
type Patch=DraftPatch|FindingPatch
beforeEach(setupControllerTest)
afterEach(()=>{cleanupControllerTest();vi.restoreAllMocks()})
const body=(text:string)=>richEditorDocumentToStoredBody(richEditorDocumentFromPlainText(text))
const schedules = (['finding', 'test_cases_draft'] as const).flatMap(kind =>
 [true, false].flatMap(proposalActive =>
  (['ack', 'hash'] as const).map(boundary => ({ kind, proposalActive, boundary }))))

it.each(schedules)('$kind navigation flush and ordinary Save preserve the next literal Save, proposal $proposalActive, restoration $boundary',async({kind,proposalActive,boundary})=>{
 const table=kind==='finding'?'findings':'drafts'
 const a=kind==='finding'?findingFixture({title:'A',...body('Body A')}):draftFixture({title:'A',...body('Body A')})
 let stored={...a}
 const base=await recordWriteGuard(a,table)
 const before=editorValue(a),after={...before,title:'B',documentJson:body('Body B').bodyJson}
 const stage={id:'stage-S',before,after,storedBaseToken:base.expectedStoredBase}
 const proposal:RefinementProposal={version:1,id:'proposal-S',userMessageId:'user-S',assistantMessageId:'assistant-S',target:{kind,snapshot:{sessionId:a.sessionId,recordId:a.id,title:a.title,documentJson:before.documentJson,metadataJson:a.metadataJson,recordKind:a.kind,origin:'saved',localFingerprint:'synthetic',storedBaseToken:base.expectedStoredBase}},patch:kind==='finding'?{kind,title:'B',bodyMarkdown:'Body B',metadata:null}:{kind,title:'B',bodyMarkdown:'Body B'},before,after,state:{kind:'offered'}}
 let chat:ChatState=chatFixture({draftId:'chat-session-1',proposals:[proposal]})
 let state='offered'
 api.getChat.mockImplementation(async()=>chat)
 api.resolveRefinement.mockImplementation(async(request:RefinementRequest)=>{
  expect(request.action).toBe('stage');state='staged';chat={...chat,revision:chat.revision+1,proposals:[{...proposal,state:{kind:'staged',stage}}]};return chat
 })
 api.listFindings.mockResolvedValue(kind==='finding'?[a]:[])
 api.listDrafts.mockResolvedValue(kind==='test_cases_draft'?[a]:[])
 const committedB=deferred<void>(),ackB=deferred<void>(),restoredA=deferred<void>(),ackA=deferred<void>()
 const requests:Array<{patch:Patch,guard:RecordWriteGuard,state:string,outcome:string}>=[]
 let armB=false,armA=false
 let holdRestorationHash=false
 if(boundary==='hash'){
  const digest=crypto.subtle.digest.bind(crypto.subtle)
  vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{
   const hold=holdRestorationHash;holdRestorationHash=false
   const hash=await digest(algorithm,data)
   if(hold){restoredA.resolve();await ackA.promise}
   return hash
  })
 }
 const command=kind==='finding'?api.updateFinding:api.updateDraft
 command.mockImplementation(async(id:string,patch:Patch,guard:RecordWriteGuard)=>{
  const request={patch,guard,state,outcome:'started'};requests.push(request)
  expect(id).toBe(a.id);expect(guard.sessionId).toBe(a.sessionId)
  const current=await recordWriteGuard(stored,table)
  const staged=guard.origin.kind!=='editor'&&guard.origin.stageId!==null
  const check=()=>{
   if(!staged)return
   expect(guard.origin.kind==='editor'?null:guard.origin.stageId).toBe(stage.id)
   if(guard.origin.kind==='proposal')expect(['staged','saved']).toContain(state)
   else expect(['saved','reverted']).toContain(state)
  }
  if(guard.origin.kind==='compensation'&&guard.origin.restoredBase===current.expectedStoredBase){check();state='reverted';request.outcome='replay';return {...stored}}
  if(guard.expectedStoredBase!==current.expectedStoredBase){request.outcome='conflict';throw new RecordWriteConflict({...stored})}
  check()
  const next={...stored,title:patch.title??stored.title,body:patch.body??stored.body,bodyJson:patch.bodyJson===undefined?stored.bodyJson:patch.bodyJson,bodyFormat:patch.bodyFormat===undefined?stored.bodyFormat:patch.bodyFormat,metadataJson:patch.metadataJson===undefined?stored.metadataJson:patch.metadataJson}
  if(guard.origin.kind==='compensation')expect((await recordWriteGuard(next,table)).expectedStoredBase).toBe(guard.origin.restoredBase)
  stored=next
  if(staged)state=guard.origin.kind==='proposal'?'saved':'reverted'
  request.outcome='committed'
  if(armB&&patch.title==='B'){armB=false;committedB.resolve();await ackB.promise}
  if(armA&&guard.origin.kind==='compensation'){
   armA=false
   if(boundary==='hash')holdRestorationHash=true
   else{restoredA.resolve();await ackA.promise}
  }
  return {...next}
 })
 const {result}=renderHook(()=>useAppController())
 await waitFor(()=>expect(result.current.activeSession?.id).toBe(a.sessionId))
 await act(async()=>result.current.setActiveView(kind==='finding'?'findings':'testware'))
 await waitFor(()=>expect((kind==='finding'?result.current.findings:result.current.testwareDrafts)[0]?.title).toBe('A'))
 const row=()=>kind==='finding'?result.current.findings[0]:result.current.testwareDrafts[0]
 const edit=(title:string)=>{const patch={title,...body('Body '+title)};if(kind==='finding')result.current.updateLocalFinding(a.id,patch);else result.current.updateLocalDraft(a.id,patch)}
 const save=()=>kind==='finding'?result.current.handleSaveFinding(result.current.findings[0]):result.current.handleSaveDraft(result.current.testwareDrafts[0])
 act(()=>edit('A'))
 await act(async()=>expect(await save()).toBe(true))
 act(()=>result.current.askAi.onAskAi({kind,recordId:a.id,title:a.title,unsaved:false}))
 if(proposalActive)await act(async()=>result.current.sessionChat.proposalControls!.onAction(proposal.id,'stage'))
 else act(()=>edit('B'))
 expect(row().title).toBe('B')
 armB=true;armA=true
 act(()=>result.current.setActiveView('settings'))
 expect(result.current.pendingNavigationView).toBe('settings')
 let navigation!:Promise<void>
 act(()=>{navigation=result.current.savePendingNavigationChanges()})
 await act(async()=>{await committedB.promise})
 expect(stored.title).toBe('B');expect(state).toBe(proposalActive?'saved':'offered');expect(result.current.isBusy).toBe(false)
 act(()=>{result.current.cancelPendingNavigation();edit('C')})
 expect(result.current.pendingNavigationView).toBeNull()
 await act(async()=>expect(await save()).toBe(false))
 expect(stored.title).toBe('B');expect(result.current.isBusy).toBe(false)
 act(()=>ackB.resolve())
 await act(async()=>{await restoredA.promise})
 expect(stored.title).toBe('A');expect(state).toBe(proposalActive?'reverted':'offered')
 act(()=>edit('D'))
 await act(async()=>expect(await save()).toBe(false))
 expect(stored.title).toBe('A')
 await act(async()=>{ackA.resolve();await navigation})
 let future=false
 await act(async()=>{future=await save()})
 expect(future).toBe(true)
 expect(stored.title).toBe('D');expect(stored.body).toBe('<p>Body D</p>')
 expect(row().title).toBe('D')
 expect(row().body).toBe('<p>Body D</p>')
 expect(row().bodyJson).toBe(body('Body D').bodyJson)
 expect(stored.bodyJson).toBe(body('Body D').bodyJson)
 expect(stored.metadataJson).toBe(a.metadataJson)
 expect(row().metadataJson).toBe(a.metadataJson)
 expect(requests.find(request => request.patch.title === 'D' && request.outcome === 'committed')?.guard).toEqual(base)
 expect(state).toBe(proposalActive?'reverted':'offered')
})
