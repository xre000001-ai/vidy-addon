import requests,subprocess,concurrent.futures,json,time
sources=['https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/BD/data.json','https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=BD&ssl=all&anonymity=all','https://proxylist.geonode.com/api/proxy-list?limit=100&page=1&sort_by=lastChecked&sort_type=desc&country=BD']
ls=[]
for i,u in enumerate(sources):
 try:
  r=requests.get(u,timeout=15);r.raise_for_status()
  if i==0:ls += [x['proxy'] for x in r.json() if x.get('protocol') in ('http','socks4','socks5')]
  elif i==1:ls += ['http://'+x.strip() for x in r.text.splitlines() if ':' in x]
  else:
   for x in r.json()['data']:
    for p in x.get('protocols',[]):
     if p in ('http','socks4','socks5'):ls.append(f"{p}://{x['ip']}:{x['port']}")
 except Exception as e:print('source error',type(e).__name__)
ls=list(dict.fromkeys(ls));print('candidate count',len(ls),flush=True)
url='https://mlsbd.co/wp-json/wp/v2/posts?per_page=5&_fields=id,title,link,content'
def scan(p):
 try:
  t=time.time();r=subprocess.run(['curl','-sS','--connect-timeout','6','--max-time','11','--proxy',p,'-A','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36','-H','Accept: application/json','-w','\n%{http_code}',url],capture_output=True,text=True,timeout=13)
  body,code=r.stdout.rsplit('\n',1);j=json.loads(body)
  if code=='200' and isinstance(j,list) and len(j)==5 and all(x.get('id') and isinstance(x.get('content'),dict) for x in j):return {'proxy':p,'ms':round((time.time()-t)*1000),'count':len(j)}
 except Exception:pass
 return None
out=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=28) as e:
 for n,x in enumerate(e.map(scan,ls),1):
  if x:out.append(x);print('VALID',len(out),'ms',x['ms'],flush=True)
  if n%50==0:print('tested',n,flush=True)
open('bd-results.json','w').write(json.dumps({'candidates':len(ls),'good':out},indent=2));print('DONE',len(out),'/',len(ls))
