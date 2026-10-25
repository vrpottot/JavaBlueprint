import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
await mkdir('/tmp/javascope-jury',{recursive:true});
const at=process.argv.indexOf('--url');
const base=at>=0?process.argv[at+1]!:'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(30000);
page.on('response',async r=>{if(r.url().includes('/api/')&&r.status()>=400)console.log(r.status(),r.url(),await r.text());});
let projectId:string|undefined;const report:any={base,checks:[]};
try {
 await page.goto(base);await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Импорт',exact:true}).click();await page.getByLabel('Добавить к текущему проекту (сохранить существующие файлы)',{exact:true}).uncheck();
 const imported=page.waitForResponse(r=>r.url().endsWith('/projects/parse')&&r.status()===201);
 await page.locator('input[type=file]').last().setInputFiles([{name:'PaletteProbe.java',mimeType:'text/plain',buffer:Buffer.from('public class PaletteProbe { public static void main(String[] args) {} }')}]);
 await page.getByRole('button',{name:'Импортировать в проект',exact:true}).click();
 const initial=await(await imported).json();projectId=initial.projectId;
 const method=initial.graph.nodes.find((n:any)=>n.data.title==='main');await page.getByLabel('Метод схемы').selectOption(method.id);
 for(let i=0;i<2;i++) {
  const changed=page.waitForResponse(r=>r.url().endsWith('/transform'));
  await page.getByRole('button',{name:'Добавить блок Переменная (примитив/обёртка)',exact:true}).click();
  const r=await changed;assert.equal(r.status(),200);report['revision'+i]=await r.json();
 }
 const verified=page.waitForResponse(r=>r.url().endsWith('/verify'));await page.getByRole('button',{name:'Run',exact:true}).click();
 report.verification=await(await verified).json();
 report.duplicateVariable=report.verification.current.compilation.exitCode!==0;
 await page.screenshot({path:'/tmp/javascope-jury/palette-duplicate.png'});
 await page.getByRole('button',{name:'Добавить блок Метод',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Добавить метод',exact:true});
 await dialog.getByLabel('Сигнатура метода',{exact:true}).fill('public PaletteProbe()');
 await dialog.getByLabel('Тело метода',{exact:true}).fill('');
 const rejected=page.waitForResponse(r=>r.url().endsWith('/transform'));
 await dialog.getByRole('button',{name:'Добавить метод',exact:true}).click();
 const r=await rejected;report.constructor={status:r.status(),body:await r.json()};
 await page.screenshot({path:'/tmp/javascope-jury/palette-constructor.png'});
 report.accurateMethodLabel=await page.getByRole('button',{name:'Добавить блок Метод',exact:true}).count()===1;
 if(report.duplicateVariable||report.constructor.status!==422||!report.accurateMethodLabel)process.exitCode=1;
 console.log({duplicateVariable:report.duplicateVariable,stderr:report.verification.current.compilation.stderr,constructor:report.constructor});
}catch(error){report.failure=String(error);await page.screenshot({path:'/tmp/javascope-jury/palette-failure.png'});throw error;}finally{
 await writeFile('/tmp/javascope-jury/palette.json',JSON.stringify(report,null,2));
 if(projectId)await page.request.delete(base+'/api/projects/'+projectId);
 await browser.close();
}
