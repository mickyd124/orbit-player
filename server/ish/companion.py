#!/usr/bin/env python3
"""Standard-library iSH server, optional FFmpeg and rclone."""
import base64, configparser, hashlib, hmac, json, mimetypes, os, pathlib, re
import secrets, shutil, signal, socket, subprocess, tempfile, threading, time
import urllib.parse as u
import urllib.request as req
import xml.etree.ElementTree as ET
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
ROOT=pathlib.Path(__file__).resolve().parents[2]
BASE=pathlib.Path(os.environ.get("ORBIT_ISH_HOME",str(pathlib.Path.home()/"orbit-ish")))
os.umask(0o077)
BASE.mkdir(parents=True,exist_ok=True)
PORT=int(os.environ.get("PORT","3000"))
TOKEN=os.environ.get("ORBIT_TOKEN") or secrets.token_hex(24)
CONFIG=BASE/"rclone.conf"
DAV=BASE/"python-webdav.json"
MODES=("orbit","multcloud","both","paused")
mode=os.environ.get("ORBIT_CLIENT_MODE","both")
if mode not in MODES: mode="both"
START=time.time()
ACTIVITY=[{"at":int(START*1000),"message":"Python companion started"}]
LOCK=threading.RLock()
SESSIONS={}
EXT=re.compile(r"\.(mp4|m4v|mkv|mov|avi|webm|ts|m2ts|wmv|flv|mpg|mpeg|ogv|3gp|3gpp|mp3|m4a|aac|flac|wav|ogg|opus|wma|ac3|eac3|dts|mka|aiff|aif|alac|mp2)$",re.I)
TYPES={"drive":"google","onedrive":"onedrive","dropbox":"dropbox","mega":"mega","webdav":"webdav"}
class Problem(Exception):
    def __init__(self,code,message):
        super().__init__(message); self.code=code
class NoRedirect(req.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None
OPENER=req.build_opener(NoRedirect())
def command(args,timeout=8):
    try:
        return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout,check=True).stdout
    except (OSError,subprocess.SubprocessError):
        raise Problem(502,"Helper command failed or timed out. Check packages and cloud configuration.")
def available(binary):
    if not shutil.which(binary): return False
    try:
        command([binary,"version" if binary=="rclone" else "-version"]); return True
    except Problem: return False
def codecs():
    f=available("ffmpeg"); p=available("ffprobe")
    def listing(flag):
        if not f: return []
        try:
            out=command(["ffmpeg","-hide_banner",flag]).decode("utf-8","replace")
            return [m.group(1) for m in re.finditer(r"^\s*[VAS][A-Z.]{5}\s+(\S+)",out,re.M) if m.group(1)!="="]
        except Problem: return []
    enc,dec=listing("-encoders"),listing("-decoders")
    return dict(ffmpeg=f,ffprobe=p,version="FFmpeg (iSH)" if f else None,encoders=enc,decoders=dec,ready="libx264" in enc and "aac" in enc)
MEDIA=codecs()
RCLONE=available("rclone")
def clients():
    return ["orbit","multcloud"] if mode=="both" else [] if mode=="paused" else [mode]
def addresses():
    try:
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1",9)); ip=s.getsockname()[0]
            return [] if ip.startswith("127.") else ["http://"+ip+":"+str(PORT)]
    except OSError: return []
def public(a): return {k:a[k] for k in ("id","type","name")}
def dav_accounts():
    try: return json.loads(DAV.read_text())
    except FileNotFoundError: return []
def write_dav(data):
    tmp=BASE/("dav-"+secrets.token_hex(8)+".tmp")
    try:
        tmp.write_text(json.dumps(data)); tmp.chmod(0o600); os.replace(tmp,DAV)
    finally:
        if tmp.exists(): tmp.unlink()
def remotes():
    if not RCLONE or not CONFIG.exists(): return []
    cfg=configparser.ConfigParser(interpolation=None)
    try: cfg.read(CONFIG)
    except configparser.Error: return []
    return [dict(id="rclone-"+n,type=TYPES[cfg[n].get("type","")],name=n,remote=n) for n in cfg.sections() if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}",n) and cfg[n].get("type") in TYPES]
def accounts():
    with LOCK: return dav_accounts()+remotes()
def account(key):
    for a in accounts():
        if a["id"]==key: return a
    raise Problem(404,"Cloud account not found.")
def safe_path(value):
    if not isinstance(value,str) or len(value)>4096 or value.startswith("/") or "\\" in value or any(ord(c)<32 for c in value) or any(p in (".","..") for p in value.split("/")):
        raise Problem(400,"Invalid cloud path.")
    return value
def dav_root(value):
    try:
        p=u.urlsplit(value)
        if not p.hostname or p.username or p.password or p.query or p.fragment or p.scheme not in ("http","https"): raise ValueError()
        if p.scheme!="https" and os.environ.get("ORBIT_ALLOW_INSECURE_WEBDAV")!="1": raise ValueError()
        return u.urlunsplit((p.scheme,p.netloc,p.path.rstrip("/")+"/","",""))
    except (ValueError,TypeError): raise Problem(400,"Use an HTTPS WebDAV root URL.")
def dav_open(a,relative="",method="GET",extra=None):
    headers={"Authorization":"Basic "+base64.b64encode((a["username"]+":"+a["password"]).encode()).decode()}
    headers.update(extra or {}); data=None
    if method=="PROPFIND":
        headers["Content-Type"]="application/xml"
        data=b'<propfind xmlns="DAV:"><prop><displayname/><resourcetype/><getcontentlength/><getcontenttype/></prop></propfind>'
    try: return OPENER.open(req.Request(a["url"]+u.quote(safe_path(relative),safe="/"),data=data,headers=headers,method=method),timeout=25)
    except (OSError,ValueError): raise Problem(502,"WebDAV request failed. Verify URL and credentials.")
def item(key,name,folder,size=0,mime=""):
    return dict(id=key,name=name,folder=bool(folder),video=not folder and (bool(EXT.search(name)) or (mime or "").startswith(("video/","audio/"))),size=max(0,int(size or 0)))
def dav_browse(a,folder):
    with dav_open(a,folder+("/" if folder and not folder.endswith("/") else ""),"PROPFIND",{"Depth":"1"}) as r: data=r.read(4*1024*1024+1)
    if len(data)>4*1024*1024 or b"<!DOCTYPE" in data.upper(): raise Problem(502,"Invalid WebDAV listing.")
    base=u.urlsplit(a["url"]); prefix=u.unquote(base.path); out=[]
    for response in ET.fromstring(data).findall(".//{DAV:}response"):
        target=u.urlsplit(u.urljoin(a["url"],response.findtext("{DAV:}href") or "")); p=u.unquote(target.path)
        if (target.scheme,target.netloc)!=(base.scheme,base.netloc) or not p.startswith(prefix) or p.rstrip("/")== (prefix+folder).rstrip("/"): continue
        relative=p[len(prefix):].rstrip("/")
        try: safe_path(relative)
        except Problem: continue
        prop=next((ps.find("{DAV:}prop") for ps in response.findall("{DAV:}propstat") if " 200 " in (ps.findtext("{DAV:}status") or "")),None)
        if prop is None: continue
        directory=prop.find("{DAV:}resourcetype/{DAV:}collection") is not None
        out.append(item(relative,prop.findtext("{DAV:}displayname") or relative.rsplit("/",1)[-1],directory,prop.findtext("{DAV:}getcontentlength") or 0,prop.findtext("{DAV:}getcontenttype") or ""))
    return out
def rargs(*args):
    return ["rclone","--config",str(CONFIG),"--contimeout","10s","--timeout","25s","--retries","1","--low-level-retries","1","--buffer-size","2M",*args]
def rpath(a,relative): return a["remote"]+":"+safe_path(relative)
def rbrowse(a,folder):
    data=json.loads(command(rargs("lsjson",rpath(a,folder)),45))
    return [item((folder.rstrip("/")+"/" if folder else "")+f["Path"],f["Name"],f["IsDir"],f.get("Size"),f.get("MimeType","")) for f in data]
def b64(raw): return base64.urlsafe_b64encode(raw).decode().rstrip("=")
def ticket(a,key,name):
    body=b64(json.dumps(dict(account=a["id"],id=key,name=name,exp=int(time.time())+14400)).encode())
    return body+"."+b64(hmac.new(TOKEN.encode(),body.encode(),hashlib.sha256).digest())
def claim(value):
    try:
        body,sig=value.split(".",1); expected=b64(hmac.new(TOKEN.encode(),body.encode(),hashlib.sha256).digest())
        if not hmac.compare_digest(sig,expected): raise ValueError()
        data=json.loads(base64.urlsafe_b64decode(body+"="*((-len(body))%4)))
        if data["exp"]<time.time(): raise ValueError()
        return data
    except (ValueError,KeyError,TypeError): raise Problem(403,"Invalid or expired playback link.")
def byte_range(value,size):
    if not value: return 0,size-1,200
    m=re.fullmatch(r"bytes=(\d*)-(\d*)",value)
    if not m or size<=0: raise Problem(416,"Invalid byte range.")
    a,b=m.groups()
    if not a:
        if not b or int(b)==0: raise Problem(416,"Invalid byte range.")
        start=max(0,size-int(b)); end=size-1
    else: start=int(a); end=min(size-1,int(b)) if b else size-1
    if start>=size or end<start: raise Problem(416,"Invalid byte range.")
    return start,end,206
def source_url(value):
    if not isinstance(value,str) or len(value)>8192: raise Problem(400,"Invalid source.")
    if value.startswith("magnet:"): raise Problem(503,"BitTorrent is unavailable in Python iSH.")
    p=u.urlsplit(value)
    if p.scheme not in ("http","https") or not p.hostname or p.username or p.password: raise Problem(400,"Use HTTP(S) without embedded credentials.")
    if p.path=="/cloud/stream":
        q=u.parse_qs(p.query)
        if "t" in q:
            claim(q["t"][0]); return "http://127.0.0.1:"+str(PORT)+p.path+"?"+p.query
    return value
def probe(url):
    if not MEDIA["ffprobe"]: return None
    try: return json.loads(command(["ffprobe","-v","error","-protocol_whitelist","http,https,tcp,tls,crypto","-rw_timeout","8000000","-probesize","2000000","-analyzeduration","2000000","-show_streams","-of","json",url],15))
    except (Problem,ValueError): return None
def plan(info,safe=False):
    streams=info.get("streams",[]) if isinstance(info,dict) else None
    v=next((s for s in streams or [] if s.get("codec_type")=="video" and not s.get("disposition",{}).get("attached_pic")),None)
    a=next((s for s in streams or [] if s.get("codec_type")=="audio"),None)
    if streams is not None and not (v or a): raise Problem(400,"No media streams found.")
    try:
        n,d=map(float,v.get("avg_frame_rate","0/1").split("/")); fps=n/d if d else 0
    except (AttributeError,ValueError): fps=0
    vc=bool(not safe and v and v.get("codec_name")=="h264" and v.get("pix_fmt")=="yuv420p" and v.get("profile") in ("Constrained Baseline","Baseline","Main","High") and 0<v.get("level",0)<=41 and 0<v.get("width",0)<=1920 and 0<v.get("height",0)<=1080 and 0<fps<=30 and v.get("field_order")=="progressive" and v.get("color_transfer") not in ("smpte2084","arib-std-b67"))
    ac=bool(not safe and a and a.get("codec_name")=="aac" and a.get("profile")=="LC" and 0<a.get("channels",0)<=2 and str(a.get("sample_rate")) in ("44100","48000"))
    return dict(video=("copy" if vc else "encode") if v or streams is None else "none",audio=("copy" if ac else "encode") if a or streams is None else "none",videoIndex=v.get("index") if v else None,audioIndex=a.get("index") if a else None,videoCodec=v.get("codec_name") if v else None,audioCodec=a.get("codec_name") if a else None)
def ffargs(url,directory,p):
    args=["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-protocol_whitelist","http,https,tcp,tls,crypto","-rw_timeout","30000000","-i",url]
    for kind,letter in (("video","V"),("audio","a")):
        if p[kind]!="none":
            idx=p[kind+"Index"]; args+=["-map","0:"+str(idx) if idx is not None else "0:"+letter+":0?"]
    args+=["-sn","-dn","-map_metadata","-1"]
    if p["video"]=="copy": args+=["-c:v","copy"]
    elif p["video"]=="encode": args+=["-c:v","libx264","-preset","ultrafast","-threads","1","-filter_threads","1","-crf","25","-maxrate","2500k","-bufsize","5000k","-vf",r"scale=w=min(1280\,iw):h=min(720\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2,fps=25","-pix_fmt","yuv420p","-profile:v","main","-level:v","3.1","-force_key_frames","expr:gte(t,n_forced*4)"]
    if p["audio"]=="copy": args+=["-c:a","copy"]
    elif p["audio"]=="encode": args+=["-c:a","aac","-profile:a","aac_low","-ac","2","-ar","48000","-b:a","128k"]
    return args+["-f","hls","-hls_time","4","-hls_list_size","0","-hls_playlist_type","event","-hls_flags","temp_file","-hls_segment_filename",str(directory/"segment%06d.ts"),str(directory/"index.m3u8")]
def destroy(key):
    with LOCK: s=SESSIONS.pop(key,None)
    if not s: return
    child=s.get("proc")
    if child and child.poll() is None:
        child.kill()
        try: child.wait(timeout=3)
        except subprocess.TimeoutExpired: pass
    shutil.rmtree(s["dir"],ignore_errors=True)
def start_session(url,safe):
    if not MEDIA["ffmpeg"]: raise Problem(503,"FFmpeg unavailable; direct playback still works.")
    url=source_url(url); key=secrets.token_hex(24)
    with LOCK:
        if SESSIONS: raise Problem(429,"iSH supports one conversion at a time.")
        directory=pathlib.Path(tempfile.mkdtemp(prefix="ish-play-",dir=BASE)); s={"dir":directory,"last":time.time()}; SESSIONS[key]=s
    try:
        p=plan(probe(url),safe)
        if (p["video"]=="encode" and "libx264" not in MEDIA["encoders"]) or (p["audio"]=="encode" and "aac" not in MEDIA["encoders"]): raise Problem(503,"Required FFmpeg encoder missing.")
        with LOCK:
            if key not in SESSIONS: raise Problem(410,"Conversion cancelled.")
            s["proc"]=subprocess.Popen(ffargs(url,directory,p),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            playlist=directory/"index.m3u8"
            if playlist.exists() and ".ts" in playlist.read_text(): return dict(id=key,playback="/media/"+key+"/index.m3u8",plan=p)
            if s["proc"].poll() is not None: raise Problem(502,"FFmpeg could not prepare media. Try direct playback or another host.")
            time.sleep(.4)
        raise Problem(504,"Conversion too slow for iSH.")
    except Exception: destroy(key); raise
def cleanup_loop():
    while True:
        time.sleep(10)
        with LOCK: snapshot=list(SESSIONS.items())
        for key,s in snapshot:
            try:
                size=sum(f.stat().st_size for f in s["dir"].iterdir() if f.is_file())
                if time.time()-s["last"]>1200 or size>512*1024*1024: destroy(key)
            except OSError: pass
class Handler(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.0"
    server_version="OrbitPython"
    def setup(self):
        super().setup(); self.connection.settimeout(35)
    def log_message(self,*args): pass
    def headers_out(self,status,mime,length=None,extra=None):
        self.send_response(status)
        for k,v in {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Allow-Methods":"GET, HEAD, POST, DELETE, OPTIONS","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Type":mime,**(extra or {})}.items(): self.send_header(k,str(v))
        if length is not None: self.send_header("Content-Length",str(length))
        self.end_headers(); self.sent=True
    def output(self,status,body,mime="application/json",extra=None):
        if not isinstance(body,bytes): body=json.dumps(body).encode()
        self.headers_out(status,mime,len(body),extra)
        if self.command!="HEAD": self.wfile.write(body)
    def body(self):
        try:
            n=int(self.headers.get("Content-Length","0"))
            if not 0<=n<=16384: raise ValueError()
            data=json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(data,dict): raise ValueError()
            return data
        except (ValueError,TypeError): raise Problem(400,"Invalid body.")
    def file(self,f):
        if not f.is_file(): raise Problem(404,"File not found.")
        mime={".js":"application/javascript",".m3u8":"application/vnd.apple.mpegurl",".ts":"video/mp2t",".css":"text/css"}.get(f.suffix,mimetypes.guess_type(str(f))[0] or "application/octet-stream")
        extra={}
        if f.parent.name=="dashboard" and f.name=="index.html": extra["Content-Security-Policy"]="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'"
        with f.open("rb") as stream:
            self.headers_out(200,mime,f.stat().st_size,extra)
            if self.command!="HEAD": shutil.copyfileobj(stream,self.wfile,65536)
    def cloud_stream(self,q):
        data=claim(q.get("t",[""])[0]); a=account(data["account"]); key=safe_path(data["id"]); rng=self.headers.get("Range")
        if rng and not re.fullmatch(r"bytes=\d*-\d*",rng): raise Problem(416,"Invalid byte range.")
        if "remote" not in a:
            with dav_open(a,key,"HEAD" if self.command=="HEAD" else "GET",{"Range":rng} if rng else {}) as r:
                extra={k:r.headers[k] for k in ("Content-Range","Accept-Ranges") if k in r.headers}
                self.headers_out(r.status,r.headers.get("Content-Type","application/octet-stream"),r.headers.get("Content-Length"),extra)
                if self.command!="HEAD": shutil.copyfileobj(r,self.wfile,65536)
            return
        stat=json.loads(command(rargs("lsjson","--stat",rpath(a,key)),30)); size=int(stat.get("Size",-1))
        if stat.get("IsDir") or size<0: raise Problem(400,"Choose a file with known size.")
        start,end,status=byte_range(rng,size); length=max(0,end-start+1); extra={"Accept-Ranges":"bytes"}
        if status==206: extra["Content-Range"]="bytes %d-%d/%d"%(start,end,size)
        mime=stat.get("MimeType") or mimetypes.guess_type(data["name"])[0] or "application/octet-stream"
        if self.command=="HEAD" or not length: return self.headers_out(status,mime,length,extra)
        child=subprocess.Popen(rargs("cat",rpath(a,key),"--offset",str(start),"--count",str(length)),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        try:
            first=child.stdout.read(min(65536,length))
            if not first: raise Problem(502,"Cloud file could not be read.")
            self.headers_out(status,mime,length,extra); self.wfile.write(first); remaining=length-len(first)
            while remaining:
                chunk=child.stdout.read(min(65536,remaining))
                if not chunk: break
                self.wfile.write(chunk); remaining-=len(chunk)
        finally:
            if child.poll() is None: child.kill()
            child.wait(); child.stdout.close()
    def route(self):
        global mode
        p=u.urlsplit(self.path); path=p.path; q=u.parse_qs(p.query); verb=self.command
        if verb=="OPTIONS": return self.output(204,b"","text/plain")
        if path.startswith("/api/") and not hmac.compare_digest(self.headers.get("Authorization","").encode(),("Bearer "+TOKEN).encode()): raise Problem(401,"Invalid companion token.")
        if path=="/api/health" and verb=="GET": return self.output(200,dict(ok=True,ffmpeg=MEDIA["ffmpeg"],clients=clients(),mode=mode,torrentEnabled=False,backend="python"))
        if path=="/api/companion/status" and verb=="GET": return self.output(200,dict(ok=True,mode=mode,clients=clients(),ffmpeg=MEDIA["ffmpeg"],torrentEnabled=False,port=PORT,addresses=addresses(),uptime=int(time.time()-START),platform="iSH / Python",runtime="Python "+__import__("platform").python_version(),node=None,sessions=len(SESSIONS),activity=ACTIVITY,media=dict(ffprobe=MEDIA["ffprobe"],ready=MEDIA["ready"],version=MEDIA["version"],encoders=len(MEDIA["encoders"]),decoders=len(MEDIA["decoders"])),rclone=RCLONE))
        if path=="/api/companion/codecs" and verb=="GET": return self.output(200,MEDIA)
        if path=="/api/companion/mode" and verb=="POST":
            if self.headers.get("Origin")!="http://"+self.headers.get("Host",""): raise Problem(403,"Open dashboard directly.")
            new=self.body().get("mode")
            if new not in MODES: raise Problem(400,"Invalid mode.")
            with LOCK:
                mode=new; ACTIVITY.insert(0,{"at":int(time.time()*1000),"message":"Client mode: "+mode}); del ACTIVITY[30:]
            return self.output(200,dict(ok=True,mode=mode,clients=clients()))
        if path=="/api/cloud/accounts" and verb=="GET":
            listed=accounts()
            return self.output(200,dict(accounts=[public(a) for a in listed],enabled={k:(k=="webdav" or any(a["type"]==k for a in listed)) for k in ("google","onedrive","dropbox","mega","terabox","webdav")},backend="python",rclone=RCLONE))
        if path=="/api/cloud/accounts/webdav" and verb=="POST":
            d=self.body(); user=d.get("username"); pw=d.get("password")
            if not isinstance(user,str) or not isinstance(pw,str) or not user or not pw: raise Problem(400,"Enter WebDAV username and password.")
            a=dict(id="dav-"+secrets.token_hex(12),type="webdav",name=str(d.get("name") or "WebDAV")[:100],url=dav_root(d.get("url")),username=user,password=pw)
            with dav_open(a,"","PROPFIND",{"Depth":"0"}): pass
            with LOCK:
                old=dav_accounts(); old.append(a); write_dav(old)
            return self.output(201,dict(account=public(a)))
        if path=="/api/cloud/accounts/mega" or path.startswith("/api/cloud/link/"): raise Problem(501,"Configure this account through rclone in iSH. TeraBox is not supported.")
        if path.startswith("/api/cloud/accounts/") and verb=="DELETE":
            a=account(u.unquote(path.rsplit("/",1)[-1]))
            if "remote" in a: raise Problem(400,"Remove rclone accounts through rclone config.")
            with LOCK: write_dav([x for x in dav_accounts() if x["id"]!=a["id"]])
            return self.output(200,dict(ok=True))
        if path.startswith("/api/cloud/browse/") and verb=="GET":
            a=account(u.unquote(path.rsplit("/",1)[-1])); folder=safe_path(q.get("folder",[""])[0])
            return self.output(200,dict(items=rbrowse(a,folder) if "remote" in a else dav_browse(a,folder),next=None))
        if path.startswith("/api/cloud/play/") and verb=="POST":
            a=account(u.unquote(path.rsplit("/",1)[-1])); d=self.body(); key=safe_path(d.get("id")); name=d.get("name")
            if not key or not isinstance(name,str) or not name or len(name)>255: raise Problem(400,"Choose a named cloud media file.")
            return self.output(200,dict(playback="/cloud/stream?t="+ticket(a,key,name)))
        if path=="/api/sessions" and verb=="POST":
            d=self.body(); return self.output(200,start_session(d.get("url"),d.get("mode")=="safe"))
        if path.startswith("/api/sessions/") and verb=="DELETE":
            destroy(path.rsplit("/",1)[-1]); return self.output(200,dict(ok=True))
        if path=="/cloud/stream" and verb in ("GET","HEAD"): return self.cloud_stream(q)
        m=re.fullmatch(r"/media/([a-f0-9]{48})/(index\.m3u8|segment\d+\.ts)",path)
        if m and verb in ("GET","HEAD"):
            with LOCK:
                s=SESSIONS.get(m[1])
                if not s: raise Problem(404,"Conversion expired.")
                s["last"]=time.time()
            return self.file(s["dir"]/m[2])
        if verb not in ("GET","HEAD") or path.startswith("/api/"): raise Problem(404,"Endpoint unavailable.")
        if path in ("/orbit","/multcloud"):
            c=path[1:]
            if c not in clients(): raise Problem(403,"Enable this app in dashboard.")
            return self.output(302,b"","text/plain",{"Location":"/?client="+c})
        assets={"/companion":"index.html","/companion.js":"dashboard.js","/companion.css":"dashboard.css"}
        if path in assets: return self.file(ROOT/"server"/"dashboard"/assets[path])
        if path=="/":
            c=q.get("client",[""])[0]
            if c in ("orbit","multcloud") and c not in clients(): raise Problem(403,"Enable this app in dashboard.")
            path="/index.html"
        if not re.fullmatch(r"/(?:[A-Za-z0-9_-]+\.(?:html|js|css|png)|vendor/[A-Za-z0-9_.-]+\.js)",path): raise Problem(404,"File not found.")
        return self.file(ROOT/"app"/path[1:])
    def handle_request(self):
        self.sent=False
        try: self.route()
        except Problem as e:
            if not self.sent: self.output(e.code,dict(error=str(e)))
        except (BrokenPipeError,ConnectionResetError,socket.timeout): pass
        except Exception:
            if not self.sent: self.output(502,dict(error="Request failed. Check configuration and connection."))
    do_GET=do_HEAD=do_POST=do_DELETE=do_OPTIONS=handle_request
def main():
    if not 1024<=PORT<=65535 or len(TOKEN)<32: raise SystemExit("Invalid port or token.")
    server=ThreadingHTTPServer(("0.0.0.0",PORT),Handler)
    threading.Thread(target=cleanup_loop,daemon=True).start()
    def stop(*args): raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM,stop)
    print("Python companion READY",flush=True)
    print("Dashboard: http://127.0.0.1:%d/companion"%PORT,flush=True)
    for addr in addresses(): print("TV URL: "+addr,flush=True)
    print("TV URL: http://YOUR-IPHONE-WIFI-IP:%d"%PORT,flush=True)
    print("Access token: "+TOKEN,flush=True)
    print("FFmpeg: %s | rclone: %s"%("ready" if MEDIA["ffmpeg"] else "unavailable","ready" if RCLONE else "unavailable"),flush=True)
    print("Keep iSH running. Ctrl+C stops companion. Private LAN only.",flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        server.server_close()
        for key in list(SESSIONS): destroy(key)
if __name__=="__main__": main()
