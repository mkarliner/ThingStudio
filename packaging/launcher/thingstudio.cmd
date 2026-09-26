@echo off
rem Thingstudio launcher (packaging\launcher\thingstudio.cmd). Runs the backend with the Python
rem bundled beside this file. -I ignores the user's PYTHONPATH/PYTHONHOME and user site-packages.
rem goto, not an if ( ) block: a path with ")" in it, such as "Program Files (x86)", would end the block early.
if exist "%~dp0python\python.exe" goto run
echo Thingstudio: its bundled Python is missing from %~dp0python. Reinstall Thingstudio. 1>&2
exit /b 1
:run
"%~dp0python\python.exe" -I -m thingstudio_backend %*
