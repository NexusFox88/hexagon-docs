from pathlib import Path
import re,json,hashlib,shutil,urllib.parse,sys
src=Path(sys.argv[1]).resolve();out=Path(__file__).resolve().parents[1];base=src/'docs/product'
pages=sorted([*base.glob('en/**/*.md'),*base.glob('zh-CN/**/*.md')]);page_set=set(p.resolve() for p in pages);resources=set();manifest=[]
def url(value,p):
 if re.match(r'^(?:[a-z]+:|#|//)',value):return value
 path,sep,frag=value.partition('#');target=(p.parent/urllib.parse.unquote(path)).resolve()
 if target in page_set:return '/'+target.relative_to(base).with_suffix('').as_posix()+(sep+frag if sep else '')
 if not target.exists() or not target.is_relative_to(src):raise ValueError((p,value))
 rel=target.relative_to(src)
 if '.local' in rel.parts:raise ValueError('Private reference')
 if target.is_dir():return 'https://github.com/NexusFox88/Hexagon/tree/main/'+rel.as_posix()+(sep+frag if sep else '')
 resources.add(target)
 return 'https://github.com/NexusFox88/hexagon-docs/blob/main/resources/'+rel.as_posix()+(sep+frag if sep else '')
def convert(s,p):
 # Preserve code literally; make links absolute and escape MDX text expressions.
 chunks=re.split(r'(^```[^\n]*\n[\s\S]*?^```[^\n]*$)',s,flags=re.M)
 for i in range(0,len(chunks),2):
  t=chunks[i];t=re.sub(r'<!--([\s\S]*?)-->',lambda m:'',t)
  t=re.sub(r'(!?\[[^\]\n]*\]\()([^\s)]+)(\))',lambda m:m[1]+url(m[2],p)+m[3],t)
  t=re.sub(r'(href|src)="([^"]+)"',lambda m:m[1]+'="'+url(m[2],p)+'"',t)
  parts=re.split(r'(`+[^`\n]*`+|<a\s[^>]*>|</a>)',t)
  for j in range(0,len(parts),2):parts[j]=parts[j].replace('{','&#123;').replace('}','&#125;').replace('<','&lt;')
  chunks[i]=''.join(parts)
 return ''.join(chunks)
for p in pages:
 s=p.read_text();title=s.splitlines()[0].removeprefix('# ');body=s.partition('\n')[2].lstrip();dest=p.relative_to(base).with_suffix('.mdx');q=out/dest;q.parent.mkdir(parents=True,exist_ok=True);q.write_text('---\ntitle: '+json.dumps(title,ensure_ascii=False)+'\n---\n\n'+convert(body,p))
 manifest.append({'source':p.relative_to(src).as_posix(),'destination':dest.as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'status':'converted'})
# Preserve source directory order, grouped by its existing headings.
langs=[]
for lang,code in [('en','en'),('zh-CN','cn')]:
 s=(base/lang/'directory.md').read_text();groups=[{'group':'Overview' if lang=='en' else '概览','pages':[lang+'/index',lang+'/directory',lang+'/agents']}];used=set(groups[0]['pages'])
 for block in re.split(r'^## ',s,flags=re.M)[1:]:
  title=block.splitlines()[0];links=re.findall(r'\]\(([^)#]+)\.md(?:#[^)]*)?\)',block);entries=[]
  for link in links:
   target=(base/lang/link).resolve();route=target.relative_to(base).as_posix()
   if target.with_suffix('.md') in page_set and route not in used:entries.append(route);used.add(route)
  if entries:groups.append({'group':title,'pages':entries})
 remaining=[p.relative_to(base).with_suffix('').as_posix() for p in pages if p.parts[len(base.parts)]==lang and p.relative_to(base).with_suffix('').as_posix() not in used]
 if remaining:groups.append({'group':'More' if lang=='en' else '更多','pages':remaining})
 langs.append({'language':code,'groups':groups})
config={'$schema':'https://mintlify.com/docs.json','theme':'mint','name':'Hexagon','colors':{'primary':'#171717','light':'#FAFAFA','dark':'#171717'},'favicon':'/favicon.svg','logo':{'light':'/logo/light.svg','dark':'/logo/dark.svg'},'navigation':{'languages':langs},'navbar':{'links':[{'label':'GitHub','href':'https://github.com/NexusFox88/Hexagon'}],'primary':{'type':'button','label':'[ Hexagon -> ]','href':'https://hexagon.autos'}},'footer':{'socials':{'github':'https://github.com/NexusFox88/Hexagon'}},'seo':{'metatags':{'canonical':'https://docs.hexagon.autos'}},'redirects':[{'source':'/','destination':'/en/index'},{'source':'/quickstart','destination':'/en/start/first-session'},{'source':'/index','destination':'/en/index'}]}
(out/'docs.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
for p in resources:
 q=out/'resources'/p.relative_to(src);q.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,q)
for mode in ['light','dark']:shutil.copyfile(src/f'brand-assets/hexagon-horizontal-{mode}.svg',out/f'logo/{mode}.svg')
shutil.copyfile(src/'brand-assets/hexagon-icon-light.svg',out/'favicon.svg')
(out/'migration-manifest.json').write_text(json.dumps({'source_repository':'https://github.com/NexusFox88/Hexagon','source_scope':'Current local product documentation snapshot; no private journals.','pages':manifest,'resources':[p.relative_to(src).as_posix() for p in sorted(resources)]},ensure_ascii=False,indent=2)+'\n')
(out/'.mintignore').write_text('resources/\ntooling/\nmigration-manifest.json\nAGENTS.md\nREADME.md\nblog/\nPUBLISHING.md\n')
for name in ['index.mdx','quickstart.mdx']:(out/name).unlink(missing_ok=True)
print(json.dumps({'pages':len(pages),'resources':len(resources),'groups':[len(l['groups']) for l in langs]}))
