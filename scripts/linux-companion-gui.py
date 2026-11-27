#!/usr/bin/env python3
"""Local desktop manager for the shared Orbit Node companion."""
import base64, json, os, pathlib, queue, subprocess, threading, tkinter as tk
from tkinter import ttk, filedialog, messagebox
import urllib.request, urllib.error, webbrowser
BASE=pathlib.Path.home()/"orbit-companion"
ROOT=tk.Tk(); ROOT.title("Orbit / MultCloud Companion"); ROOT.geometry("790x620")
events=queue.Queue()
def background(fn,done):
    def work():
        try: events.put((done,fn(),None))
        except Exception as exc: events.put((done,None,str(exc)))
    threading.Thread(target=work,daemon=True).start()
def tick():
    while not events.empty():
        done,result,error=events.get()
        if error: status.set(error)
        else: done(result)
    ROOT.after(100,tick)
def config():
    return json.loads((BASE/"companion-settings.json").read_text())
def origin():
    return "http://127.0.0.1:"+str(config().get("PORT",3000))
def api(path,body=None,method=None):
    cfg=config()
    request=urllib.request.Request(origin()+"/api/"+path,data=None if body is None else json.dumps(body).encode(),headers={"Authorization":"Bearer "+cfg["ORBIT_TOKEN"],"Content-Type":"application/json"},method=method)
    try:
        with urllib.request.urlopen(request,timeout=210) as response: return json.load(response)
    except urllib.error.HTTPError as e:
        try: msg=json.load(e).get("error","Request failed")
        except Exception: msg="HTTP "+str(e.code)
        raise RuntimeError(msg)
status=tk.StringVar(value="Start the companion, then refresh.")
proc=None
def start():
    global proc
    if proc and proc.poll() is None: return
    try:
        log=open(BASE/"desktop.log","a")
        try: proc=subprocess.Popen(["sh",str(BASE/"start.sh"),"both"],env={**os.environ,"ORBIT_NO_BROWSER":"1"},stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        finally: log.close()
        status.set("Starting server; select Refresh once ready.")
    except Exception as e: status.set(str(e))
def stop():
    if proc and proc.poll() is None: proc.terminate();status.set("Stopping desktop-launched companion.")
def browser(path):
    try: webbrowser.open(origin()+path)
    except Exception as e: status.set(str(e))
bar=ttk.Frame(ROOT,padding=12);bar.pack(fill="x")
for label,fn in [("Start server",start),("Stop server",stop),("Browser dashboard",lambda:browser("/companion")),("Cloud authorization",lambda:browser("/multcloud"))]:
    ttk.Button(bar,text=label,command=fn).pack(side="left",padx=3)
tabs=ttk.Notebook(ROOT);tabs.pack(fill="both",expand=True,padx=12,pady=8)
streams=ttk.Frame(tabs,padding=12);cloud=ttk.Frame(tabs,padding=12);tabs.add(streams,text="Torrent streaming");tabs.add(cloud,text="Cloud accounts")
def field(parent,label,var,secret=False):
    ttk.Label(parent,text=label).pack(anchor="w")
    ttk.Entry(parent,textvariable=var,show="*" if secret else "").pack(fill="x",pady=(0,8))
magnet=tk.StringVar(); title=tk.StringVar(); file=tk.StringVar()
field(streams,"Magnet link",magnet);field(streams,"Stream title",title)
ttk.Label(streams,textvariable=file,wraplength=680).pack(anchor="w")
def pick():
    p=filedialog.askopenfilename(filetypes=[("Torrent files","*.torrent")])
    if p: file.set(p)
ttk.Button(streams,text="Choose .torrent file",command=pick).pack(anchor="w")
ttk.Button(streams,text="Clear selected file",command=lambda:file.set("")).pack(anchor="w")
streamlist=tk.Listbox(streams,height=6);streamlist.pack(fill="both",expand=True,pady=8)
active=[]
def show_streams(data):
    active[:]=data.get("sessions",[]);streamlist.delete(0,"end")
    for s in active: streamlist.insert("end",s["title"])
    status.set("Ready streams: "+str(len(active))+" — open Desktop streams on TV.")
def refresh_streams(): background(lambda:api("sessions"),show_streams)
def launch():
    m=magnet.get().strip();p=file.get();name=title.get().strip() or (pathlib.Path(p).stem if p else "Magnet stream")
    if bool(m)==bool(p): status.set("Enter either a magnet link or a torrent file, not both.");return
    status.set("Preparing stream; peer discovery and conversion may take several minutes.")
    def work():
        body={"title":name,"shared":True}
        if p:
            with open(p,"rb") as f: data=f.read(1048577)
            if len(data)>1048576: raise ValueError("Torrent metadata exceeds 1 MiB.")
            body["torrentBase64"]=base64.b64encode(data).decode()
        else: body["url"]=m
        return api("sessions",body)
    background(work,lambda _:refresh_streams())
ttk.Button(streams,text="Start streaming",command=launch).pack(anchor="w")
def selected():
    sel=streamlist.curselection()
    return active[sel[0]] if sel else None
def stop_stream():
    s=selected()
    if s: background(lambda:api("sessions/"+s["id"],method="DELETE"),lambda _:refresh_streams())
def copy_stream():
    s=selected()
    if s:
        def done(data):
            addresses=data.get("addresses",[])
            url=(addresses[0] if addresses else origin())+s["playback"]
            ROOT.clipboard_clear();ROOT.clipboard_append(url);status.set("Stream URL copied. Keep it private.")
        background(lambda:api("companion/status"),done)
actions=ttk.Frame(streams);actions.pack(fill="x",pady=4)
for label,fn in [("Refresh streams",refresh_streams),("Stop selected",stop_stream),("Copy playback URL",copy_stream)]:
    ttk.Button(actions,text=label,command=fn).pack(side="left",padx=3)
provider=tk.StringVar(value="mega");user=tk.StringVar();pw=tk.StringVar();url=tk.StringVar();label=tk.StringVar()
ttk.Combobox(cloud,textvariable=provider,values=["mega","webdav"],state="readonly").pack(fill="x",pady=4)
field(cloud,"Email / username",user);field(cloud,"Password / app password",pw,True);field(cloud,"WebDAV URL (WebDAV only)",url);field(cloud,"Account label (WebDAV only)",label)
accountlist=tk.Listbox(cloud,height=5);accountlist.pack(fill="both",expand=True)
def show_accounts(data):
    accountlist.delete(0,"end")
    for a in data.get("accounts",[]):accountlist.insert("end",a["name"]+" — "+a["type"])
    status.set("Cloud accounts refreshed.")
def refresh_cloud():background(lambda:api("cloud/accounts"),show_accounts)
def add_cloud():
    kind=provider.get();u=user.get().strip();password=pw.get()
    body={"email":u,"password":password} if kind=="mega" else {"username":u,"password":password,"url":url.get().strip(),"name":label.get().strip() or "WebDAV"}
    pw.set("");status.set("Checking cloud login…")
    background(lambda:api("cloud/accounts/"+kind,body),lambda _:refresh_cloud())
buttons=ttk.Frame(cloud);buttons.pack(fill="x")
ttk.Button(buttons,text="Save cloud account",command=add_cloud).pack(side="left")
ttk.Button(buttons,text="Refresh accounts",command=refresh_cloud).pack(side="left")
ttk.Button(buttons,text="Other providers / OAuth",command=lambda:browser("/multcloud")).pack(side="left")
ttk.Label(ROOT,textvariable=status,wraplength=740,padding=12).pack(fill="x")
ROOT.after(100,tick);ROOT.mainloop()
