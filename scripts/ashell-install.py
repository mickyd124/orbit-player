# Run with python3 ashell-install.py inside full a-Shell.
import io, os, pathlib, secrets, shutil, ssl, sys, tempfile, urllib.request, zipfile
base=pathlib.Path.home()/"Documents"/"orbit-ashell"
base.mkdir(parents=True,exist_ok=True)
os.umask(0o077)
url="https://codeload.github.com/mickyd124/orbit-player/zip/refs/heads/main"
with urllib.request.urlopen(url,timeout=120) as r:
    data=r.read(100*1024*1024+1)
if len(data)>100*1024*1024: raise SystemExit("Source archive exceeds limit.")
with tempfile.TemporaryDirectory(dir=base) as temp:
    stage=pathlib.Path(temp)/"source";stage.mkdir()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for entry in z.infolist():
            parts=pathlib.PurePosixPath(entry.filename).parts
            if len(parts)<2 or entry.is_dir(): continue
            rel=parts[1:]
            if any(x in ("..","",".") for x in rel) or entry.filename.startswith("/"): raise SystemExit("Unsafe archive path.")
            if rel[0] not in ("app","server"): continue
            dest=stage.joinpath(*rel);dest.parent.mkdir(parents=True,exist_ok=True)
            with z.open(entry) as src,dest.open("wb") as out: shutil.copyfileobj(src,out)
    for name in ("app/index.html","app/vendor/hls.min.js","app/vendor/mega.browser.js","server/ish/companion.py"):
        if not (stage/name).is_file(): raise SystemExit("Missing required file: "+name)
    compile((stage/"server/ish/companion.py").read_text(),"companion.py","exec")
    target=base/"source";backup=base/"source-previous"
    if backup.exists(): shutil.rmtree(backup)
    if target.exists(): target.rename(backup)
    try: stage.rename(target)
    except Exception:
        if backup.exists(): backup.rename(target)
        raise
token=base/"token"
if not token.exists(): token.write_text(secrets.token_hex(24))
token.chmod(0o600)
print("Installed. Run: python3 ~/Documents/orbit-ashell/start.py")
print("FFmpeg CLI: in a-Shell run ffmpeg -version; if missing run pkg install ffmpeg.")
print("Server conversion remains disabled because iOS process spawning is unsupported.")
(base/"start.py").write_text("""import os, pathlib, runpy
base=pathlib.Path(__file__).resolve().parent
os.environ.update(ORBIT_ASHELL='1',ORBIT_ISH_HOME=str(base),ORBIT_TOKEN=(base/'token').read_text().strip())
os.environ.setdefault('ORBIT_CLIENT_MODE','both')
runpy.run_path(str(base/'source/server/ish/companion.py'),run_name='__main__')
""")
