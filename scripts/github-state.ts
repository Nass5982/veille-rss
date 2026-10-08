import {remoteState} from "../src/lib/publication/github-state";
const command=process.argv[2];
async function main(){
try{if(command!=="pull"&&command!=="push")throw new Error("Commande pull ou push attendue.");await remoteState(command,{repository:process.env.GITHUB_REPOSITORY??"",token:process.env.GH_TOKEN??"",directory:".rss-state",initialize:process.env.RSS_INITIALIZE_STATE==="true",secret:process.env.RSS_STATE_KEY});console.log(`État chiffré : ${command} terminé.`);}catch(e){console.error(e instanceof Error?e.message:"Échec de la persistance GitHub.");process.exitCode=1;}

}
void main();
