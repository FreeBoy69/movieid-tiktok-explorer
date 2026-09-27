// The runtime every Explainer Studio film is assembled on. Opus writes one
// chapter at a time against this API; the runtime owns the clock, chapter
// crossfades, captions, and the few UI pieces a walkthrough keeps reusing
// (browser frame, phone, cursor, spotlight, zoom). Everything is computed from
// t on every seek, so it renders frame-exact in the Promo renderer.

export const CROSSFADE = 0.2;

// Plain ES5 on purpose: it runs inside the sandboxed film, next to window.M.
export const EXPLAINER_RUNTIME = String.raw`(function(){
var CFG=JSON.parse(document.getElementById("ex-timeline").textContent);
var T=CFG.theme, W=CFG.width, H=CFG.height, F=${CROSSFADE};
var host=document.getElementById("ex-chapters"), capBox=document.getElementById("ex-caption"), capText=document.getElementById("ex-caption-text");
var clamp=function(v,a,b){return Math.min(b,Math.max(a,v))};
var ease=function(k){k=clamp(k,0,1);return k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2};
var registry={}, reported={};
window.__exErrors=[];
function report(n,kind,e){var key=n+":"+kind;if(reported[key])return;reported[key]=1;var msg="Chapter "+n+": "+(e&&e.message?e.message:String(e));window.__exErrors.push(msg);console.error(msg);setTimeout(function(){throw new Error(msg)},0)}
function el(tag,cls,parent,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;if(parent)parent.appendChild(e);return e}
function css(e,o){for(var k in o)e.style[k]=o[k];return e}
function spec(n){for(var i=0;i<CFG.chapters.length;i++)if(CFG.chapters[i].n===n)return CFG.chapters[i];return null}
var DOTS=["#ff5f57","#febc2e","#28c840"];
var ARROW='<svg viewBox="0 0 28 28" width="100%" height="100%"><path d="M5 3 L5 23 L10.2 18.2 L13.6 25.6 L17.4 23.9 L14 16.6 L21 16.6 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
window.EX={
  width:W,height:H,theme:T,captions:CFG.captions,safeBottom:CFG.captions?Math.round(H*0.2):Math.round(H*0.06),
  el:el,css:css,
  chapter:function(n,build){
    var s=spec(n);
    if(!s||registry[n])return;
    var root=el("div","ex-ch",host);root.id="ch-"+n;root.style.display="none";
    var C={index:n,title:s.title,duration:s.duration,lines:s.lines,visuals:s.visuals,width:W,height:H,theme:T,safeBottom:EX.safeBottom};
    var render=null;
    try{render=build(root,C)}catch(e){report(n,"build",e)}
    if(typeof render!=="function"){if(render!==null)report(n,"build","the build function must return render(t)");render=function(){}}
    registry[n]={s:s,root:root,render:render};
  },
  browser:function(parent,o){
    o=o||{};var bar=Math.round((o.h||H*0.7)*0.07);
    var root=css(el("div","ex-browser",parent),{left:(o.x||0)+"px",top:(o.y||0)+"px",width:(o.w||W*0.8)+"px",height:(o.h||H*0.7)+"px"});
    var top=css(el("div","ex-browser-bar",root),{height:bar+"px"});
    for(var i=0;i<3;i++)css(el("span","ex-browser-dot",top),{background:DOTS[i],width:Math.round(bar*0.26)+"px",height:Math.round(bar*0.26)+"px"});
    var address=css(el("span","ex-browser-url",top,o.url||""),{fontSize:Math.round(bar*0.38)+"px",height:Math.round(bar*0.62)+"px",lineHeight:Math.round(bar*0.62)+"px"});
    var view=css(el("div","ex-browser-view",root),{top:bar+"px"});
    return {root:root,bar:top,url:address,view:view,viewWidth:(o.w||W*0.8),viewHeight:(o.h||H*0.7)-bar};
  },
  phone:function(parent,o){
    o=o||{};var h=o.h||H*0.8,w=h*0.4615;
    var root=css(el("div","ex-phone",parent),{left:(o.x!=null?o.x:(W-w)/2)+"px",top:(o.y!=null?o.y:(H-h)/2)+"px",width:w+"px",height:h+"px",borderRadius:Math.round(w*0.13)+"px",padding:Math.round(w*0.035)+"px"});
    var view=css(el("div","ex-phone-view",root),{borderRadius:Math.round(w*0.1)+"px"});
    return {root:root,view:view,viewWidth:w*0.93,viewHeight:h-w*0.07};
  },
  shot:function(parent,id,o){
    o=o||{};var img=el("img","ex-shot",parent);img.alt="";img.setAttribute("src","asset:"+id);
    css(img,{objectFit:o.fit||"cover",objectPosition:o.position||"top center"});
    return img;
  },
  cursor:function(parent){
    var box=css(el("div","ex-cursor",parent),{width:Math.round(Math.min(W,H)*0.034)+"px",height:Math.round(Math.min(W,H)*0.034)+"px"});
    box.innerHTML=ARROW;
    var ring=el("div","ex-ripple",parent);
    return {el:box,render:function(t,keys){
      if(!keys||!keys.length||t<keys[0][0]-0.3){box.style.opacity="0";ring.style.opacity="0";return}
      var x=keys[0][1],y=keys[0][2],i;
      for(i=0;i<keys.length;i++){
        var k=keys[i];if(t<k[0]-0)break;x=k[1];y=k[2];
      }
      if(i<keys.length&&i>0){var a=keys[i-1],b=keys[i],move=Math.min(0.7,Math.max(0.15,(b[0]-a[0])*0.8)),p=ease((t-(b[0]-move))/move);if(t>b[0]-move){x=a[1]+(b[1]-a[1])*p;y=a[2]+(b[2]-a[2])*p}}
      var press=1,rip=-1,rx=0,ry=0;
      for(var j=0;j<keys.length;j++){var c=keys[j];if(!c[3])continue;var d=t-c[0];if(d>=0&&d<0.14)press=0.86;if(d>=0&&d<0.45){rip=d/0.45;rx=c[1];ry=c[2]}}
      css(box,{opacity:String(clamp((t-keys[0][0]+0.3)/0.25,0,1)),transform:"translate("+x+"px,"+y+"px) scale("+press+")"});
      if(rip<0)ring.style.opacity="0";else css(ring,{opacity:String(0.55*(1-rip)),transform:"translate("+rx+"px,"+ry+"px) translate(-50%,-50%) scale("+(0.3+rip*1.4)+")"});
    }};
  },
  spotlight:function(parent){
    var ring=el("div","ex-spot",parent);
    return {el:ring,render:function(k,b){
      k=clamp(k,0,1);if(!b||k<=0){ring.style.opacity="0";return}
      var pad=10;css(ring,{opacity:String(k),left:(b.x-pad)+"px",top:(b.y-pad)+"px",width:(b.w+pad*2)+"px",height:(b.h+pad*2)+"px",boxShadow:"0 0 0 9999px rgba(10,10,14,"+(0.42*k)+")"});
    }};
  },
  focus:function(content,viewW,viewH,b,k){
    k=clamp(k,0,1);content.style.transformOrigin="0 0";
    var S=1,X=0,Y=0;
    if(b&&k>0&&b.w>0&&b.h>0){var s=Math.min(viewW/b.w,viewH/b.h)*0.9;S=1+(s-1)*k;X=(viewW/2-(b.x+b.w/2)*s)*k;Y=(viewH/2-(b.y+b.h/2)*s)*k}
    content.style.transform=S===1&&X===0&&Y===0?"none":"translate("+X+"px,"+Y+"px) scale("+S+")";
    return {scale:S,point:function(x,y){return [X+x*S,Y+y*S]},rect:function(r){return r?{x:X+r.x*S,y:Y+r.y*S,w:r.w*S,h:r.h*S}:r}};
  },
  typed:function(text,t,t0,cps){if(t<t0)return "";return String(text).slice(0,Math.max(0,Math.floor((t-t0)*(cps||16))))},
  line:function(C,t){for(var i=0;i<C.lines.length;i++){var l=C.lines[i];if(t>=l.start&&t<l.end)return i}return -1}
};
// Runs after every chapter script: a chapter that never registered (a script that failed to load) is reported like any other chapter error.
EX.check=function(){for(var i=0;i<CFG.chapters.length;i++){var n=CFG.chapters[i].n;if(!registry[n])report(n,"load","the chapter's script never ran")}};
EX.seek=function(t){
  var list=CFG.chapters;
  for(var i=0;i<list.length;i++){
    var s=list[i],r=registry[s.n];if(!r)continue;
    var a=i===0?-1:s.start-F,b=i===list.length-1?Infinity:s.end+F;
    if(t<a||t>=b){r.root.style.display="none";continue}
    r.root.style.display="block";r.root.style.zIndex=String(i+1);
    r.root.style.opacity=i===0?"1":String(clamp((t-(s.start-F))/(2*F),0,1));
    try{r.render(clamp(t-s.start,0,s.duration))}catch(e){report(s.n,"render",e)}
  }
  var cue=null;
  if(CFG.captions)for(var j=0;j<CFG.cues.length;j++){var c=CFG.cues[j];if(t>=c.start&&t<c.end){cue=c;break}}
  if(!cue){capBox.style.opacity="0";capText.textContent=""}
  else{capText.textContent=cue.text;capBox.style.opacity=String(clamp((t-cue.start)/0.12,0,1))}
};
window.seek=EX.seek;
})();`;

/** The film's shell: stage, chapter host, captions bar, and the shared UI pieces' styles. */
export function explainerShellCss({ width, height, theme, captions }) {
  const unit = Math.min(width, height);
  const capSize = Math.round(unit / (width < height ? 24 : 26));
  return `#stage{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${theme.bg};color:${theme.ink};font-family:${theme.font}}
#ex-chapters,.ex-ch{position:absolute;inset:0}
.ex-ch{overflow:hidden;background:${theme.bg}}
#ex-caption{position:absolute;left:50%;bottom:${Math.round(height * 0.055)}px;transform:translateX(-50%);max-width:${Math.round(width * 0.84)}px;z-index:100;opacity:0;text-align:center;pointer-events:none${captions ? "" : ";display:none"}}
#ex-caption-text{display:inline;padding:${Math.round(capSize * 0.22)}px ${Math.round(capSize * 0.5)}px;border-radius:${Math.round(capSize * 0.3)}px;background:rgba(12,12,16,.78);color:#fff;font:600 ${capSize}px/1.45 ${theme.font};-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ex-browser{position:absolute;border-radius:${Math.round(unit * 0.014)}px;overflow:hidden;background:${theme.surface};box-shadow:0 ${Math.round(unit * 0.02)}px ${Math.round(unit * 0.06)}px rgba(15,15,25,.18),0 0 0 1px rgba(15,15,25,.08)}
.ex-browser-bar{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:${Math.round(unit * 0.008)}px;padding:0 ${Math.round(unit * 0.016)}px;background:${theme.chrome};border-bottom:1px solid rgba(15,15,25,.08)}
.ex-browser-dot{display:inline-block;border-radius:50%}
.ex-browser-url{margin-left:${Math.round(unit * 0.02)}px;flex:1;max-width:60%;padding:0 ${Math.round(unit * 0.014)}px;border-radius:999px;background:${theme.surface};color:${theme.muted};font-family:${theme.font};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ex-browser-view{position:absolute;left:0;right:0;bottom:0;overflow:hidden;background:${theme.surface}}
.ex-phone{position:absolute;box-sizing:border-box;background:#0d0d10;box-shadow:0 ${Math.round(unit * 0.03)}px ${Math.round(unit * 0.08)}px rgba(15,15,25,.25)}
.ex-phone-view{position:relative;width:100%;height:100%;overflow:hidden;background:${theme.surface}}
.ex-shot{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
.ex-cursor{position:absolute;left:0;top:0;z-index:50;opacity:0;transform-origin:0 0;filter:drop-shadow(0 2px 3px rgba(0,0,0,.3))}
.ex-ripple{position:absolute;left:0;top:0;z-index:49;width:${Math.round(unit * 0.07)}px;height:${Math.round(unit * 0.07)}px;border-radius:50%;border:${Math.max(2, Math.round(unit * 0.004))}px solid ${theme.accent};opacity:0}
.ex-spot{position:absolute;z-index:40;border-radius:${Math.round(unit * 0.012)}px;border:${Math.max(2, Math.round(unit * 0.003))}px solid ${theme.accent};opacity:0;pointer-events:none}`;
}
