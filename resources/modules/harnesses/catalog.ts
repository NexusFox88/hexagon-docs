import {harnessTemplates} from './templates.js';
import {protocolContract, type HarnessProtocol} from './protocols.js';
import {verifiedHarnessCombinations} from './verification.js';

/** Evidence is specific to the exact executable image and command, never a provider-wide badge. */
export interface HarnessVerification {
 image: string;
 protocol: HarnessProtocol;
 command: string[];
 sandbox_provider: string;
 model_provider: string;
 model: string;
 clients: ('python'|'typescript')[];
 scenarios: string[];
 checked_at: string;
 evidence: string;
}
export const harnessVerifications: HarnessVerification[] = verifiedHarnessCombinations;
export function harnessCatalogEntry(h: any) {
 const protocol: HarnessProtocol = h.protocol ?? (h.id==='opencode'?'opencode-v1':h.id==='pi'?'pi-v1':'hexagon-json-v1');
 const contract=protocolContract(protocol);
 const image=typeof h.image==='string'?h.image:h.image?.reference;
 const verification=harnessVerifications.filter(v=>v.image===image&&v.protocol===protocol&&JSON.stringify(v.command)===JSON.stringify(h.command));
 return {...h,protocol,model_providers:h.model_providers??contract.model_providers,continuation:contract.continuation,
  distribution:image?'registry':h.recipe?'recipe':h.source==='package'?'package':'builtin',verification};
}
export const templateCatalog=()=>harnessTemplates.map(harnessCatalogEntry);
