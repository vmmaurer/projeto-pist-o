
'use strict';

const DATA={
 original:{src:'models/piston_original_web.glb',tag:'CONFIGURAÇÃO ORIGINAL',title:'Bowl raso e largo',desc:'Pistão completo com foco na coroa. A concavidade é mais aberta e a área externa de squish é convencional.',bowl:'Raso / largo',throat:'Aberta',squish:'Convencional',transition:'Suaves'},
 proposed:{src:'models/piston_proposed_web.glb',tag:'CONFIGURAÇÃO PROPOSTA',title:'Bowl re-entrante otimizado',desc:'Coroa redesenhada para destacar garganta mais estreita, maior profundidade central e maior área externa de squish.',bowl:'Profundo / re-entrante',throat:'Mais estreita',squish:'Ampliada',transition:'Contínuas'}
};

const GL={
 viewers:[],
 async loadGLB(url){
   const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error('HTTP '+r.status+' ao carregar '+url);
   const buf=await r.arrayBuffer();
   const dv=new DataView(buf); const magic=dv.getUint32(0,true); if(magic!==0x46546c67) throw new Error('Arquivo GLB inválido');
   let off=12,json=null,bin=null;
   while(off<buf.byteLength){
     const len=dv.getUint32(off,true),type=dv.getUint32(off+4,true); off+=8;
     const chunk=buf.slice(off,off+len); off+=len;
     if(type===0x4E4F534A) json=JSON.parse(new TextDecoder().decode(chunk));
     else if(type===0x004E4942) bin=chunk;
   }
   if(!json||!bin) throw new Error('GLB sem chunks JSON/BIN');
   const prim=json.meshes[0].primitives[0];
   const posAcc=json.accessors[prim.attributes.POSITION];
   const idxAcc=json.accessors[prim.indices];
   const posView=json.bufferViews[posAcc.bufferView];
   const idxView=json.bufferViews[idxAcc.bufferView];
   const posOff=(posView.byteOffset||0)+(posAcc.byteOffset||0);
   const idxOff=(idxView.byteOffset||0)+(idxAcc.byteOffset||0);
   const positions=new Float32Array(bin.slice(posOff,posOff+posAcc.count*12));
   const idxBytes = idxAcc.componentType===5123 ? 2 : idxAcc.componentType===5121 ? 1 : 4;
   const rawIdx = bin.slice(idxOff,idxOff+idxAcc.count*idxBytes);
   const indices = idxAcc.componentType===5123 ? new Uint16Array(rawIdx) : idxAcc.componentType===5121 ? new Uint8Array(rawIdx) : new Uint32Array(rawIdx);
   const normals=new Float32Array(positions.length);
   for(let i=0;i<indices.length;i+=3){
     const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
     const ax=positions[b]-positions[a],ay=positions[b+1]-positions[a+1],az=positions[b+2]-positions[a+2];
     const bx=positions[c]-positions[a],by=positions[c+1]-positions[a+1],bz=positions[c+2]-positions[a+2];
     const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;
     normals[a]+=nx;normals[a+1]+=ny;normals[a+2]+=nz;
     normals[b]+=nx;normals[b+1]+=ny;normals[b+2]+=nz;
     normals[c]+=nx;normals[c+1]+=ny;normals[c+2]+=nz;
   }
   for(let i=0;i<normals.length;i+=3){const x=normals[i],y=normals[i+1],z=normals[i+2],l=Math.hypot(x,y,z)||1;normals[i]=x/l;normals[i+1]=y/l;normals[i+2]=z/l;}
   return {positions,normals,indices,count:indices.length,scale:0.001};
 }
};

class Viewer{
 constructor(canvas,status){
   this.canvas=canvas;this.status=status;this.gl=canvas.getContext('webgl2',{antialias:true,alpha:false,preserveDrawingBuffer:false})||canvas.getContext('webgl',{antialias:true,alpha:false});
   if(!this.gl) throw new Error('WebGL não disponível neste dispositivo');
   this.program=this.makeProgram(); this.mesh=null; this.loaded=false; this.radius=1; this.center=[0,0,0];
   this.yaw=45*Math.PI/180;this.pitch=70*Math.PI/180;this.distance=2.2;this.target=[0,0,0];this.auto=false;this.pointers=new Map();this.lastPinch=null;this.lastCenter=null;
   this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);
   this.bind(); this.frame();
 }
 shader(type,src){const gl=this.gl,s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s}
 makeProgram(){const gl=this.gl;
   const vs=this.shader(gl.VERTEX_SHADER,`attribute vec3 aPos;attribute vec3 aNor;uniform mat4 uProj,uView,uModel;uniform vec3 uCenter;varying vec3 vN;varying vec3 vP;void main(){vec3 p=aPos-uCenter;vec4 w=uModel*vec4(p,1.0);vP=w.xyz;vN=mat3(uModel)*aNor;gl_Position=uProj*uView*w;}`);
   const fs=this.shader(gl.FRAGMENT_SHADER,`precision mediump float;varying vec3 vN;varying vec3 vP;uniform vec3 uColor;uniform vec3 uLight;uniform float uClipX;uniform bool uClip;
      void main(){if(uClip && vP.x<0.0)discard;vec3 n=normalize(vN);float d=max(dot(n,normalize(uLight)),0.0);float rim=pow(1.0-max(dot(n,vec3(0.0,0.0,1.0)),0.0),2.0);vec3 c=uColor*(0.25+0.72*d)+uColor*0.09*rim;gl_FragColor=vec4(c,1.0);}`);
   const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
   return p;
 }
 bind(){
   const c=this.canvas;
   c.addEventListener('pointerdown',e=>{c.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});c.classList.add('dragging');});
   c.addEventListener('pointermove',e=>{if(!this.pointers.has(e.pointerId))return;const old=this.pointers.get(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const arr=[...this.pointers.values()];
     if(arr.length===1){this.yaw-=(e.clientX-old.x)*0.008;this.pitch-= (e.clientY-old.y)*0.008;this.pitch=Math.max(0.10,Math.min(Math.PI-0.10,this.pitch));}
     else if(arr.length===2){const a=arr[0],b=arr[1];const center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};const dist=Math.hypot(a.x-b.x,a.y-b.y);if(this.lastPinch!=null){this.distance*=Math.pow(this.lastPinch/(dist||1),0.9);this.distance=this.clamp(this.distance,0.55,5.0);}if(this.lastCenter){this.target[0]-=(center.x-this.lastCenter.x)*0.0014*this.distance;this.target[1]+=(center.y-this.lastCenter.y)*0.0014*this.distance;}this.lastPinch=dist;this.lastCenter=center;}
   });
   const end=e=>{this.pointers.delete(e.pointerId);if(this.pointers.size<2){this.lastPinch=null;this.lastCenter=null}if(this.pointers.size===0)c.classList.remove('dragging')};
   c.addEventListener('pointerup',end);c.addEventListener('pointercancel',end);
   c.addEventListener('wheel',e=>{e.preventDefault();this.distance*=Math.exp(e.deltaY*0.001);this.distance=this.clamp(this.distance,0.55,5.0)},{passive:false});
 }
 clamp(v,a,b){return Math.max(a,Math.min(b,v))}
 async load(url){this.status.textContent='Carregando modelo 3D…';this.status.className='status';this.status.classList.remove('hidden','error');try{this.mesh=await GL.loadGLB(url);this.normalize();this.upload();this.loaded=true;this.status.classList.add('hidden');this.reset();}catch(err){console.error(err);this.status.textContent='Falha ao carregar o modelo: '+err.message+'. Confirme se a pasta models está junto do index.html.';this.status.classList.add('error');}}
 normalize(){const p=this.mesh.positions;let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<p.length;i+=3){for(let j=0;j<3;j++){min[j]=Math.min(min[j],p[i+j]);max[j]=Math.max(max[j],p[i+j]);}}
   const c=[(min[0]+max[0])/2,(min[1]+max[1])/2,(min[2]+max[2])/2];const size=Math.max(max[0]-min[0],max[1]-min[1],max[2]-min[2]);for(let i=0;i<p.length;i++)p[i]=(p[i]-c[Math.floor((i%3))])/size;this.center=[0,0,0];this.radius=0.5;}
 upload(){const gl=this.gl,m=this.mesh;this.pos=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.pos);gl.bufferData(gl.ARRAY_BUFFER,m.positions,gl.STATIC_DRAW);this.nor=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.nor);gl.bufferData(gl.ARRAY_BUFFER,m.normals,gl.STATIC_DRAW);this.idx=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.idx);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,m.indices,gl.STATIC_DRAW);}
 resize(){const r=this.canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;this.gl.viewport(0,0,w,h)}}
 setView(name){if(name==='top'){this.yaw=0;this.pitch=0.12;}else if(name==='side'){this.yaw=Math.PI/2;this.pitch=Math.PI/2;}else{this.yaw=Math.PI/4;this.pitch=70*Math.PI/180;} }
 reset(){this.setView('iso');this.distance=2.2;this.target=[0,0,0];}
 zoom(delta){this.distance=this.clamp(this.distance*(delta<0?0.86:1.16),0.55,5.0)}
 frame=()=>{requestAnimationFrame(this.frame);if(!this.gl)return;if(this.auto)this.yaw+=0.004;this.draw()}
 perspective(fov,aspect,near,far){const f=1/Math.tan(fov/2),nf=1/(near-far);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0])}
 lookAt(eye,center,up){let z=[eye[0]-center[0],eye[1]-center[1],eye[2]-center[2]],zl=Math.hypot(...z)||1;z=z.map(v=>v/zl);let x=[up[1]*z[2]-up[2]*z[1],up[2]*z[0]-up[0]*z[2],up[0]*z[1]-up[1]*z[0]],xl=Math.hypot(...x)||1;x=x.map(v=>v/xl);let y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]),-(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]),-(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]),1])}
 draw(){const gl=this.gl;if(!this.loaded)return;this.resize();gl.enable(gl.DEPTH_TEST);gl.clearColor(0.043,0.059,0.078,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
   const aspect=this.canvas.width/this.canvas.height;const proj=this.perspective(42*Math.PI/180,aspect,0.01,100);const cp=Math.cos(this.pitch),sp=Math.sin(this.pitch),cy=Math.cos(this.yaw),sy=Math.sin(this.yaw);const eye=[this.target[0]+this.distance*cp*sy,this.target[1]+this.distance*sp,this.target[2]+this.distance*cp*cy];const view=this.lookAt(eye,this.target,[0,1,0]);
   const model=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
   const aPos=gl.getAttribLocation(this.program,'aPos'),aNor=gl.getAttribLocation(this.program,'aNor');gl.bindBuffer(gl.ARRAY_BUFFER,this.pos);gl.enableVertexAttribArray(aPos);gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,this.nor);gl.enableVertexAttribArray(aNor);gl.vertexAttribPointer(aNor,3,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.idx);
   gl.uniformMatrix4fv(gl.getUniformLocation(this.program,'uProj'),false,proj);gl.uniformMatrix4fv(gl.getUniformLocation(this.program,'uView'),false,view);gl.uniformMatrix4fv(gl.getUniformLocation(this.program,'uModel'),false,model);gl.uniform3fv(gl.getUniformLocation(this.program,'uCenter'),this.center);gl.uniform3f(gl.getUniformLocation(this.program,'uLight'),-0.35,0.75,0.6);gl.uniform3f(gl.getUniformLocation(this.program,'uColor'),0.63,0.66,0.70);gl.uniform1i(gl.getUniformLocation(this.program,'uClip'),0);
   const indexType=this.mesh.indices instanceof Uint16Array?gl.UNSIGNED_SHORT:this.mesh.indices instanceof Uint8Array?gl.UNSIGNED_BYTE:gl.UNSIGNED_INT;
   gl.drawElements(gl.TRIANGLES,this.mesh.count,indexType,0);
 }
}

let viewers={};
try{
  viewers.main=new Viewer(document.getElementById('canvasMain'),document.getElementById('statusMain'));
  viewers.a=new Viewer(document.getElementById('canvasA'),document.getElementById('statusA'));
  viewers.b=new Viewer(document.getElementById('canvasB'),document.getElementById('statusB'));
  Promise.all([viewers.main.load(DATA.original.src),viewers.a.load(DATA.original.src),viewers.b.load(DATA.proposed.src)]);
}catch(e){document.querySelectorAll('.status').forEach(s=>{s.textContent=e.message;s.classList.add('error')})}

const stageSingle=document.getElementById('stageSingle'),stageCompare=document.getElementById('stageCompare');
const btnOriginal=document.getElementById('btnOriginal'),btnProposed=document.getElementById('btnProposed'),btnCompare=document.getElementById('btnCompare');
const title=document.getElementById('title'),desc=document.getElementById('description'),tag=document.getElementById('tag');
const mBowl=document.getElementById('mBowl'),mThroat=document.getElementById('mThroat'),mSquish=document.getElementById('mSquish'),mTransition=document.getElementById('mTransition');
let current='original',currentView='iso',rotating=false;
function setMode(mode){current=mode;[btnOriginal,btnProposed,btnCompare].forEach(b=>b.classList.remove('active'));
 if(mode==='compare'){btnCompare.classList.add('active');stageSingle.classList.remove('active');stageCompare.classList.add('active');[viewers.a,viewers.b].forEach(v=>{v.setView(currentView);v.distance=2.2;v.auto=rotating});return}
 stageSingle.classList.add('active');stageCompare.classList.remove('active');(mode==='original'?btnOriginal:btnProposed).classList.add('active');const d=DATA[mode];tag.textContent=d.tag;title.textContent=d.title;desc.textContent=d.desc;mBowl.textContent=d.bowl;mThroat.textContent=d.throat;mSquish.textContent=d.squish;mTransition.textContent=d.transition;viewers.main.load(d.src);viewers.main.setView(currentView);viewers.main.auto=rotating;}
function active(){return current==='compare'?[viewers.a,viewers.b]:[viewers.main]}
function setView(v){currentView=v;active().forEach(x=>x.setView(v));document.querySelectorAll('.viewBtn').forEach(b=>b.classList.toggle('active',b.dataset.view===v))}

document.querySelectorAll('.viewBtn').forEach(b=>b.onclick=()=>setView(b.dataset.view));
document.getElementById('zoomIn').onclick=()=>active().forEach(v=>v.zoom(-1));document.getElementById('zoomOut').onclick=()=>active().forEach(v=>v.zoom(1));document.getElementById('reset').onclick=()=>active().forEach(v=>v.reset());
document.getElementById('autoRotate').onclick=()=>{rotating=!rotating;document.getElementById('autoRotate').classList.toggle('active',rotating);active().forEach(v=>v.auto=rotating)};
document.getElementById('toggleInfo').onclick=()=>document.getElementById('info').classList.toggle('show');
btnOriginal.onclick=()=>setMode('original');btnProposed.onclick=()=>setMode('proposed');btnCompare.onclick=()=>setMode('compare');
window.addEventListener('resize',()=>Object.values(viewers).forEach(v=>v.resize()));
