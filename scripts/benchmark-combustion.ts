/** Compare on the same machine: npx tsx scripts/benchmark-combustion.ts [baseline-root]. */
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const results = [];
for (const root of [...(process.argv[2] ? [process.argv[2]] : []), '.']) {
  const { Simulation, M } = await import(pathToFileURL(resolve(root, 'src/simulation.ts')).href);
  const { MaterialRenderer } = await import(pathToFileURL(resolve(root, 'src/rendering.ts')).href);
  for (const scene of ['fir', 'burn-tree', 'fire']) {
    const s = new Simulation(960,576);
    s.load(scene === 'burn-tree' ? 'fir' : scene);
    if (scene === 'burn-tree') {
      const rect = (x:number,y:number,w:number,h:number,t:number) => { for(let yy=y*4;yy<(y+h)*4;yy++)for(let xx=x*4;xx<(x+w)*4;xx++)s.set(xx,yy,t); };
      rect(108,132,8,4,M.Stone);rect(108,129,1,3,M.Stone);rect(115,129,1,3,M.Stone);rect(110,130,4,2,M.Lava);
    }
    for(let t=0;t<600;t++)s.step();
    const renderer = new MaterialRenderer(960,576), image = {data:new Uint8ClampedArray(960*576*4)} as ImageData;
    const step:number[] = [], render:number[] = [];
    for(let t=0;t<180;t++){
      let start=performance.now();s.step();step.push(performance.now()-start);
      if(t%3===0){start=performance.now();renderer.render(image,s);render.push(performance.now()-start);}
    }
    const summary=(v:number[])=>{v.sort((a,b)=>a-b);return{mean:+(v.reduce((a,b)=>a+b)/v.length).toFixed(2),p95:+v[Math.floor(v.length*.95)].toFixed(2)}};
    results.push({root,scene,stepMs:summary(step),renderMs:summary(render),ticks:s.ticks,counts:s.counts()});
    console.log(JSON.stringify(results.at(-1)));
  }
}
