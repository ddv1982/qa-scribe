/**
 * Clipboard HTML in the shape Confluence and Excel put on the clipboard: Confluence wraps the
 * table, styles cells by class and puts blocks (paragraphs, lists) in cells; Excel sends a whole
 * document with a style sheet, column widths, inline styles, a merged cell and a line break that
 * stays in the cell.
 */
export const confluenceTableHtml = `<meta charset="utf-8"><div class="table-wrap"><table data-layout="default" data-local-id="a1" class="confluenceTable"><colgroup><col style="width: 120px;"><col style="width: 340px;"></colgroup><tbody><tr><th class="confluenceTh"><p><strong>Step</strong></p></th><th class="confluenceTh"><p><strong>Expected result</strong></p></th></tr><tr><td class="confluenceTd"><p>Open <a href="https://example.com/checkout">checkout</a></p></td><td class="confluenceTd"><p>The basket shows</p><ul><li><p>one item</p></li><li><p>the <code>EUR</code> total</p></li></ul></td></tr><tr><td class="confluenceTd" colspan="2"><p><em>Notes span both columns</em></p></td></tr></tbody></table></div>`

export const excelTableHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta http-equiv=Content-Type content="text/html; charset=utf-8"><style>
<!--table {mso-displayed-decimal-separator:"\\,";}
.xl65 {font-weight:700;}
-->
</style></head><body link="#0563C1" vlink="#954F72"><table border=0 cellpadding=0 cellspacing=0 width=256 style='border-collapse:collapse;width:192pt'><!--StartFragment--><col width=64 span=4 style='width:48pt'><tr height=20 style='height:15.0pt'><td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt'>Case</td><td class=xl65 width=64 style='width:48pt'>Input</td><td class=xl65 width=64 style='width:48pt'>Result</td><td class=xl65 width=64 style='width:48pt'>Remark</td></tr><tr height=40 style='height:30.0pt'><td height=40 style='height:30.0pt'>TC01</td><td>1234 AB<br style='mso-data-placement:same-cell;'>NL</td><td colspan=2 style='mso-ignore:colspan'>Passed</td></tr><tr height=20 style='height:15.0pt'><td height=20 style='height:15.0pt'>TC02</td><td></td><td>Failed</td><td x:str="'=500">=500</td></tr><!--EndFragment--></table></body></html>`
