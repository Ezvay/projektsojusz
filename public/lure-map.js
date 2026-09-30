/* Shared dragging behavior for Grota and Mapa śmierci. Coordinates stay normalized. */
window.createLureMap = function({container, layer, socket, prefix, getGenerals, getLabels, canDrag, onClick}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1000 1000');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible';
  const note = document.createElement('div');
  note.setAttribute('role','status');
  note.style.cssText='position:absolute;left:12px;top:12px;z-index:15;background:#100d08e8;color:#f0d080;padding:8px 12px;border:1px solid #c9a84c;pointer-events:none;display:none;max-width:85%';
  container.appendChild(note);
  let active=null, noteTimer;
  function tell(text) { clearTimeout(noteTimer); note.textContent=text; note.style.display='block'; noteTimer=setTimeout(()=>note.style.display='none',2600); }
  function point(event) {
    const r=container.getBoundingClientRect();
    return {x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))};
  }
  function dropPoint(event) {
    const r=container.getBoundingClientRect();
    if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)return null;
    return point(event);
  }
  function destination(g) { return g.lureTarget || getLabels().find(l=>l.id===g.lureLabelId); }
  function line(g,target,preview=false) {
    const el=document.createElementNS(svg.namespaceURI,'line');
    for(const [k,v] of Object.entries({x1:g.x*1000,y1:g.y*1000,x2:target.x*1000,y2:target.y*1000,stroke:preview?'#fff':'#f0d080','stroke-width':3,'stroke-dasharray':'9 7','vector-effect':'non-scaling-stroke'}))el.setAttribute(k,v);
    svg.appendChild(el);
    const circle=document.createElementNS(svg.namespaceURI,'circle');
    for(const [k,v] of Object.entries({cx:g.x*1000,cy:g.y*1000,r:5,fill:'#100d08',stroke:'#f0d080','stroke-width':2,'vector-effect':'non-scaling-stroke'}))circle.setAttribute(k,v);
    svg.appendChild(circle);
  }
  function redraw() {
    if(svg.parentNode!==layer)layer.prepend(svg);
    svg.replaceChildren();
    for(const g of Object.values(getGenerals())) {
      const target=destination(g);
      if(target&&active?.g.id!==g.id)line(g,target);
    }
    if(active?.dragging)line(active.g,active.target||active.pos,true);
  }
  function attach(marker,g) {
    marker.style.touchAction='none';
    marker.style.userSelect='none';
    marker.style.cursor='grab';
    marker.addEventListener('dragstart',e=>e.preventDefault());
    marker.addEventListener('pointerdown',e=>{
      if(e.button!==0||active||!canDrag())return;
      e.preventDefault();e.stopPropagation();
      const start={x:e.clientX,y:e.clientY};
      const drag={g,marker,pointerId:e.pointerId,start,pos:point(e),target:null,dragging:false};
      active=drag;
      const begin=()=>{if(active!==drag)return;drag.dragging=true;marker.style.cursor='grabbing';redraw();};
      const hold=setTimeout(begin,220);
      marker.setPointerCapture(e.pointerId);
      const move=ev=>{
        if(ev.pointerId!==drag.pointerId)return;
        if(!drag.dragging&&Math.hypot(ev.clientX-start.x,ev.clientY-start.y)>6)begin();
        if(!drag.dragging)return;
        ev.preventDefault();drag.pos=point(ev);drag.target=dropPoint(ev);
        marker.style.left=drag.pos.x*100+'%';marker.style.top=drag.pos.y*100+'%';
        redraw();
      };
      const end=ev=>{
        if(ev.pointerId!==drag.pointerId)return;
        clearTimeout(hold);
        marker.removeEventListener('pointermove',move);marker.removeEventListener('pointerup',end);marker.removeEventListener('pointercancel',end);marker.removeEventListener('lostpointercapture',end);
        active=null;
        if(marker.hasPointerCapture(ev.pointerId))marker.releasePointerCapture(ev.pointerId);
        const cancelled=ev.type!=='pointerup';
        const target=dropPoint(ev);
        const original=destination(g)||g;
        marker.style.left=original.x*100+'%';marker.style.top=original.y*100+'%';marker.style.cursor='grab';
        if(drag.dragging&&!cancelled) {
          if(target) {socket.emit(prefix+'SetLure',{id:g.id,x:target.x,y:target.y},ok=>{if(ok)tell('Zapisano cel lurowania');});}
          else tell('Upuść generała w obrębie mapy. Cel nie został zmieniony.');
        } else if(!cancelled)onClick(g.id);
        redraw();
      };
      marker.addEventListener('pointermove',move);marker.addEventListener('pointerup',end);marker.addEventListener('pointercancel',end);marker.addEventListener('lostpointercapture',end);
    });
  }
  return {attach,redraw,isDragging:()=>!!active};
};
