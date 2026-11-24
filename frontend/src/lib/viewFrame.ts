/**
 * HTML views: sandboxed iframes that render contributed UI (sidebar tabs, status widgets,
 * custom blocks, custom nodes, Home HTML widgets).
 *
 * A view gets `window.noteral` inside the frame:
 *   noteral.props                    // { data, ...context } — what the host passed in
 *   noteral.app.<ns>.<method>(params) // the App API, with the owner's permissions
 *   noteral.call(method, params)
 *   noteral.setData(data)            // persist the view's data (blocks, nodes, Home widgets)
 *   noteral.onProps(fn) / onTheme(fn) / onMessage(fn)
 *   noteral.on(event, fn)            // app events, e.g. "document:changed"
 *   noteral.post(name, payload)      // message the owning plugin ("view:message" event)
 *   noteral.open(target)             // a page id, noteral://page/<id> or an https URL
 *   noteral.resize()                 // re-measure height (automatic via ResizeObserver)
 *
 * The frame is sandboxed with `allow-scripts` only (opaque origin, no parent access) and a
 * CSP that blocks all network access, so every outside effect goes through the App API.
 */
import { TOKEN_NAMES } from "./customizations";

export const VIEW_PROTOCOL = 1;

/** Small shared kit so views look native without writing much CSS. */
const KIT_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent;color:var(--text);font:13px/1.5 var(--font-ui);-webkit-font-smoothing:antialiased}
body{overflow-wrap:anywhere}
html[data-fill] ,html[data-fill] body{height:100%}
a{color:var(--accent-deep);text-decoration:underline;text-underline-offset:2px;cursor:pointer}
h1,h2,h3,h4{margin:0 0 .4em;line-height:1.25;color:var(--text)}
h1{font-size:20px}h2{font-size:16px}h3{font-size:14px}h4{font-size:13px}
p{margin:0 0 .6em}
code,pre{font-family:var(--font-mono);font-size:12px}
pre{background:var(--bg-sunken);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px;overflow:auto}
hr{border:0;border-top:1px solid var(--border);margin:10px 0}
button,input,select,textarea{font:inherit;color:inherit}
.n-btn,button{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:0 10px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--bg-raised);color:var(--text);cursor:pointer}
.n-btn:hover,button:hover{background:var(--bg-hover)}
.n-btn.primary,button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.n-btn.ghost,button.ghost{border-color:transparent;background:transparent}
.n-input,input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea{min-height:28px;padding:4px 8px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--bg-sunken);outline:none}
.n-input:focus,input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-softer)}
.n-card{background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px}
.n-muted{color:var(--text-muted)}.n-faint{color:var(--text-faint)}
.n-row{display:flex;align-items:center;gap:8px}.n-col{display:flex;flex-direction:column;gap:8px}
.n-grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
.n-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;background:var(--accent-softer);color:var(--accent-deep);font-size:12px}
.n-list{list-style:none;margin:0;padding:0}.n-list>li{padding:6px 8px;border-radius:var(--radius-sm)}.n-list>li:hover{background:var(--bg-hover)}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--border);padding:5px 6px;text-align:left}th{color:var(--text-muted);font-weight:600;font-size:12px}
::selection{background:var(--selection)}
`;

function bridgeScript(): string {
  // Plain ES5-ish so it runs anywhere; kept tiny.
  return `(function(){
var P=parent,seq=0,pending={},subs={},H={props:[],theme:[],message:[]};
var boot=JSON.parse(document.getElementById("noteral-boot").textContent);
function send(m){m.__nv=${VIEW_PROTOCOL};P.postMessage(m,"*");}
function fire(list,arg){for(var i=0;i<list.length;i++){try{list[i](arg)}catch(e){report(e)}}}
function report(e){send({type:"error",message:String(e&&e.message||e).slice(0,400)});}
var N={props:boot.props,theme:boot.theme,
call:function(method,params){return new Promise(function(res,rej){var id=++seq;pending[id]={res:res,rej:rej};send({type:"call",id:id,method:String(method),params:params||{}});});},
setData:function(data){N.props=Object.assign({},N.props,{data:data});send({type:"setData",data:data});},
onProps:function(f){H.props.push(f);return function(){H.props=H.props.filter(function(x){return x!==f})}},
onTheme:function(f){H.theme.push(f);return function(){H.theme=H.theme.filter(function(x){return x!==f})}},
onMessage:function(f){H.message.push(f);return function(){H.message=H.message.filter(function(x){return x!==f})}},
on:function(ev,f){ev=String(ev);if(!subs[ev]){subs[ev]=[];send({type:"subscribe",event:ev});}subs[ev].push(f);return function(){subs[ev]=(subs[ev]||[]).filter(function(x){return x!==f})}},
post:function(name,payload){send({type:"post",name:String(name),payload:payload===undefined?null:payload});},
open:function(target){send({type:"open",target:String(target)});},
notify:function(message,kind){return N.call("ui.notify",{message:String(message),kind:kind||"info"});},
resize:function(){measure(true);}
};
N.setProps=N.setData;
N.app=new Proxy({},{get:function(_,ns){return new Proxy({},{get:function(_,m){return function(p){return N.call(String(ns)+"."+String(m),p)}}})}});
window.noteral=N;
window.addEventListener("message",function(e){if(e.source!==P)return;var m=e.data;if(!m||m.__nv!==${VIEW_PROTOCOL})return;
if(m.type==="response"){var p=pending[m.id];if(!p)return;delete pending[m.id];if(m.ok)p.res(m.result);else{var err=new Error(m.error||"failed");err.code=m.code;p.rej(err);}}
else if(m.type==="props"){N.props=m.props;fire(H.props,m.props);}
else if(m.type==="theme"){N.theme=m.theme;apply(m.tokens,m.theme);fire(H.theme,m.theme);}
else if(m.type==="event"){fire(subs[m.event]||[],m.data);}
else if(m.type==="message"){fire(H.message,{name:m.name,payload:m.payload});}
});
function apply(tokens,theme){var r=document.documentElement;for(var k in tokens){r.style.setProperty("--"+k,tokens[k]);}r.dataset.theme=theme;r.style.colorScheme=theme;}
var last=-1;function measure(force){var h=Math.ceil(Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0));if(force||Math.abs(h-last)>1){last=h;send({type:"resize",height:h});}}
window.addEventListener("error",function(e){report(e.error||e.message)});
window.addEventListener("unhandledrejection",function(e){report(e.reason)});
document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var href=a.getAttribute("href");if(!href||href.charAt(0)==="#")return;e.preventDefault();N.open(href);},true);
document.addEventListener("DOMContentLoaded",function(){try{new ResizeObserver(function(){measure(false)}).observe(document.body)}catch(e){}measure(true);send({type:"ready"});});
})();`;
}

function escapeScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}

export function themeTokens(): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof document === "undefined") return out;
  const style = getComputedStyle(document.documentElement);
  for (const name of TOKEN_NAMES) {
    const value = style.getPropertyValue(`--${name}`).trim();
    if (value) out[name] = value;
  }
  return out;
}

export function currentTheme(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export interface ViewDocOptions {
  html: string;
  props: unknown;
  fill?: boolean;
}

/** The srcdoc for a view: CSP, theme tokens, the kit, the bridge, then the author's HTML. */
export function viewSrcdoc({ html, props, fill }: ViewDocOptions): string {
  const theme = currentTheme();
  const tokens = themeTokens();
  const vars = Object.entries(tokens)
    .map(([name, value]) => `--${name}:${value.replace(/[;{}<>]/g, "")};`)
    .join("");
  const boot = JSON.stringify({ props, theme }).replace(/</g, "\\u003c");
  const isDocument = /<html[\s>]/i.test(html);
  const head = `<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data:; media-src data: blob: https:;">
<style>:root{${vars}color-scheme:${theme}}${KIT_CSS}</style>
<script type="application/json" id="noteral-boot">${boot}</script>
<script>${escapeScript(bridgeScript())}</script>`;
  const fillAttr = fill ? " data-fill" : "";
  if (isDocument) {
    // Inject our head into the author's document.
    const withHtmlAttr = html.replace(/<html([\s>])/i, `<html data-theme="${theme}"${fillAttr}$1`);
    if (/<head[\s>]/i.test(withHtmlAttr)) return withHtmlAttr.replace(/<head([^>]*)>/i, `<head$1>${head}`);
    return withHtmlAttr.replace(/<html([^>]*)>/i, `<html$1><head>${head}</head>`);
  }
  return `<!doctype html><html data-theme="${theme}"${fillAttr}><head>${head}</head><body>${html}</body></html>`;
}

// ── hub: lets the app reach every mounted view ────────────────────────────────

export interface MountedView {
  /** Contribution or instance key, used to address messages. */
  key: string;
  ownerKind: "plugin" | "layer" | "app";
  ownerId: string;
  permissions: readonly string[];
  subscriptions: Set<string>;
  post(message: Record<string, unknown>): void;
}

const mounted = new Set<MountedView>();

export const viewHub = {
  add(view: MountedView) {
    mounted.add(view);
    return () => mounted.delete(view);
  },
  /** True when some view subscribed to the event. */
  wants(event: string, allowed: (view: MountedView) => boolean): boolean {
    for (const view of mounted) if (view.subscriptions.has(event) && allowed(view)) return true;
    return false;
  },
  emit(event: string, data: unknown, allowed: (view: MountedView) => boolean) {
    for (const view of mounted) if (view.subscriptions.has(event) && allowed(view)) view.post({ type: "event", event, data });
  },
  /** Deliver a message to views of one owner, optionally only those whose key matches. */
  message(ownerKind: string, ownerId: string, name: string, payload: unknown, key?: string): number {
    let count = 0;
    for (const view of mounted) {
      if (view.ownerKind !== ownerKind || view.ownerId !== ownerId) continue;
      if (key && view.key !== key && !view.key.startsWith(`${key}#`)) continue;
      view.post({ type: "message", name, payload });
      count += 1;
    }
    return count;
  },
  broadcastTheme() {
    const tokens = themeTokens();
    const theme = currentTheme();
    for (const view of mounted) view.post({ type: "theme", tokens, theme });
  },
};
