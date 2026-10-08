import { load } from "cheerio";
import { isPublicUrl } from "./public-url";
export function safeHTML(input:string):string {
 const $=load(input.slice(0,40000));$("script,style,iframe,object,embed,svg,math,form,input,video,audio").remove();
 const allowed=new Set(["p","br","strong","b","em","i","ul","ol","li","blockquote","a","code","pre","h2","h3","h4","span"]);
 $("body *").toArray().reverse().forEach(el=>{if(!("name" in el))return;const node=$(el);if(!allowed.has(el.name)){node.replaceWith(node.contents());return;}for(const key of Object.keys(el.attribs))if(!(el.name==="a"&&key==="href"))node.removeAttr(key);if(el.name==="a"){const href=node.attr("href");if(!href||!isPublicUrl(href))node.removeAttr("href");node.attr("rel","noopener noreferrer");}});
 return $("body").html()??"";
}
