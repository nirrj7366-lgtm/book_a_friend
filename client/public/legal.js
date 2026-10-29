(function(){
var B=(window.YAARI_CONFIG&&window.YAARI_CONFIG.BUSINESS)||{};
var map={BUSINESS_NAME:B.name,ADDRESS:B.address,EMAIL:B.email,PHONE:B.phone,GRIEVANCE:B.grievanceOfficer||B.name,CITY:B.city||"Kolkata",DATE:B.effective};
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
var el=document.getElementById("content"),h=el.innerHTML,todo=false;
Object.keys(map).forEach(function(k){var v=map[k]||("[Add "+k+" in config.js]");if(/^YOUR|^\[Add/i.test(v))todo=true;h=h.split("{{"+k+"}}").join(esc(v))});
el.innerHTML=h;
})();
