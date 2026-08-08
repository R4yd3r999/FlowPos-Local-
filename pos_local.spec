# -*- mode: python ; coding: utf-8 -*-
#
# Spec de PyInstaller para FlowPos (Local). Se usa igual en Linux y en
# Windows -- PyInstaller no cruza plataformas: hay que correr este
# mismo comando EN Linux para el binario Linux, y EN Windows para el
# .exe. Ver el README para el paso a paso completo.
#
# Uso: pyinstaller pos_local.spec

a = Analysis(
    ['run.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('frontend', 'frontend'),
        ('frontend_mesero', 'frontend_mesero'),
        ('schema.sql', '.'),
    ],
    hiddenimports=[
        'app.main',
        'app.routers.auth',
        'app.routers.productos',
        'app.routers.insumos',
        'app.routers.cuentas',
        'app.routers.billar',
        'app.routers.cierre',
        'app.routers.reportes',
        'app.routers.red',
        'app.routers.dashboard',
        'qrcode',
        'qrcode.image.svg',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='FlowPos',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
