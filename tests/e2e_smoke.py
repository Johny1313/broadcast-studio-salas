"""Compatibilidade: use o teste atualizado com três câmeras e a quarta playlist."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('v11_e2e.py')),run_name='__main__')
