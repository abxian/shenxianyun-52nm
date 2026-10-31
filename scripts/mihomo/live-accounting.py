"""Isolated loopback integration: real short HTTP proxy traffic + DIRECT.
Usage python live-accounting.py CORE. No system proxy/TUN/VPS/production writes.
Creates private temporary config, closes only its own processes/listeners.
"""
import http.server,socketserver,socket,threading,select,subprocess,tempfile,json,time,urllib.request,sys
from pathlib import Path
class Origin(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  body=b'x'*65536;self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def log_message(self,*args):pass
class Upstream(socketserver.StreamRequestHandler):
 def handle(self):
  line=self.rfile.readline().decode();assert line.startswith('CONNECT ')
  hostport=line.split()[1]
  while self.rfile.readline() not in [b'\r\n',b'\n',b'']:pass
  host,port=hostport.rsplit(':',1)
  with socket.create_connection(('127.0.0.1',int(port))) as dest:
   self.wfile.write(b'HTTP/1.1 200 Connection established\r\n\r\n');self.wfile.flush()
   while True:
    for src in select.select([self.connection,dest],[],[],5)[0]:
     data=src.recv(65536)
     if not data:return
     (dest if src is self.connection else self.connection).sendall(data)
class Server(socketserver.ThreadingTCPServer):allow_reuse_address=True;daemon_threads=True
origin=http.server.ThreadingHTTPServer(('127.0.0.1',0),Origin);upstream=Server(('127.0.0.1',0),Upstream)
for server in [origin,upstream]:threading.Thread(target=server.serve_forever,daemon=True).start()
def freeport():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
mixed,api=freeport(),freeport()
with tempfile.TemporaryDirectory(prefix='sxy-accounting-') as tmp:
 config={'mixed-port':mixed,'bind-address':'127.0.0.1','external-controller':'127.0.0.1:'+str(api),'mode':'rule','ipv6':False,'hosts':{'direct.test':'127.0.0.1','proxy.test':'127.0.0.1'},'proxies':[{'name':'http-leaf','type':'http','server':'127.0.0.1','port':upstream.server_address[1]}],'proxy-groups':[{'name':'via-proxy','type':'select','proxies':['http-leaf']},{'name':'alias-direct','type':'select','proxies':['DIRECT']}],'rules':['DOMAIN,direct.test,alias-direct','MATCH,via-proxy']}
 p=Path(tmp);(p/'config.yaml').write_text(json.dumps(config));log=(p/'core.log').open('wb');core=subprocess.Popen([sys.argv[1],'-d',tmp],stdout=log,stderr=log)
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 def stats():return json.loads(opener.open('http://127.0.0.1:'+str(api)+'/connections',timeout=2).read())
 def transfer(host):
  with socket.create_connection(('127.0.0.1',mixed),timeout=5) as s:
   url='http://'+host+':'+str(origin.server_address[1])+'/payload'
   s.sendall(('GET '+url+' HTTP/1.1\r\nHost: '+host+':'+str(origin.server_address[1])+'\r\nConnection: close\r\n\r\n').encode());data=b''
   while True:
    chunk=s.recv(65536)
    if not chunk:break
    data+=chunk
   assert data.endswith(b'x'*65536), repr(data[:500])
 try:
  for i in range(100):
   try:baseline=stats();break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('core startup failed')
  # Controller starts before listeners/rules are fully activated. Wait for a
  # real direct transfer, rather than mistaking the early controller for ready.
  for attempt in range(100):
   try:transfer('direct.test');break
   except (OSError,AssertionError):time.sleep(.1)
  else:raise RuntimeError('core listener did not become ready')
  baseline=stats()
  assert baseline['proxyUploadTotal']==0 and baseline['proxyDownloadTotal']==0
  transfer('direct.test');direct=stats()
  assert direct['downloadTotal']>=65536 and direct['proxyDownloadTotal']==0 and direct['proxyUploadTotal']==0
  for _ in range(5):transfer('proxy.test')
  proxied=stats();assert proxied['proxyDownloadTotal']>=5*65536 and proxied['proxyUploadTotal']>0
  transfer('direct.test');final=stats();assert final['proxyDownloadTotal']==proxied['proxyDownloadTotal'] and final['proxyUploadTotal']==proxied['proxyUploadTotal']
  print(json.dumps({'direct_excluded':True,'short_closed_proxy_preserved':True,'proxied_upload':proxied['proxyUploadTotal'],'proxied_download':proxied['proxyDownloadTotal'],'direct_after_proxy_excluded':True}))
 except Exception:
  log.flush();print((p/'core.log').read_text(),file=sys.stderr);raise
 finally:
  core.terminate();core.wait(timeout=10);log.close();origin.shutdown();upstream.shutdown()
