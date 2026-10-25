import {mkdir,writeFile} from 'node:fs/promises';
import {JavaParserEngine} from '../src/adapters/java-engine.js';
import {DockerRunner} from '../src/adapters/docker-runner.js';
const {PALETTE_ITEMS}=await import(new URL('../../frontend/src/lib/palette.ts',import.meta.url).href) as {PALETTE_ITEMS:{id:string;name:string;type:string;defaultCode:string}[]};
await mkdir('/tmp/javascope-jury',{recursive:true});
const methods=PALETTE_ITEMS.filter(p=>p.type!=='method').map((p,i)=>{
 const vars=[p.id==='variable'?'':'int value=1;',p.id==='col-list'?'':'List<String> list=new ArrayList<>();',p.id==='col-listof'?'':'List<String> items=List.of("x");','String text="x"; int number=1; boolean condition=false;'].join('');
 return `static void template${i}(){${vars}\n${p.defaultCode}\n}`;
});
const files=[{path:'PaletteContracts.java',content:'import java.util.*; class PaletteContracts {\n'+methods.join('\n')+'\n}'}];
await writeFile('/tmp/javascope-jury/palette-source.json',JSON.stringify(files));
let ir:any={errors:[]};
try{ir=await new JavaParserEngine().process(files);}catch(error){ir={errors:[String(error)]};}
const individual=[];
for(let i=0;i<methods.length;i++) {
 try {const r=await new JavaParserEngine().process([{path:'One.java',content:'import java.util.*; class One{'+methods[i]+'}'}]);individual.push({name:PALETTE_ITEMS[i+1]!.name,errors:r.errors});}
 catch(error){individual.push({name:PALETTE_ITEMS[i+1]!.name,error:String(error)});}
}
const result=await new DockerRunner().verify(files,files,{},0);
await writeFile('/tmp/javascope-jury/palette-contracts.json',JSON.stringify({items:PALETTE_ITEMS.map(p=>({id:p.id,name:p.name,code:p.defaultCode})),individual,irErrors:ir.errors,verification:result,files},null,2));
console.log('templates',methods.length,'parseErrors',ir.errors.length,'compilation',result.current.compilation);

if(ir.errors.length||result.current.compilation.exitCode!==0)process.exitCode=1;
