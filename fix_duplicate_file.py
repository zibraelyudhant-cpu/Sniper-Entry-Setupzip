"""
Script generik buat benerin file yang isinya kedobelan (ke-copy 2x jadi 1
file). Jalanin dari root project Replit:
  python3 fix_duplicate_file.py <path/ke/file>

Contoh:
  python3 fix_duplicate_file.py "artifacts/mobile/app/(tabs)/breakout.tsx"
"""
import sys

if len(sys.argv) < 2:
    print("Pakai: python3 fix_duplicate_file.py <path/ke/file>")
    sys.exit(1)

path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    content = f.read()

n = len(content)
half = n // 2

found = None
for offset in range(-300, 301):
    cut = half + offset
    if cut <= 0 or cut >= n:
        continue
    if content[:cut] == content[cut:]:
        found = cut
        break

if found is None:
    print(f"GAK KETEMU titik potong presisi di {path} -- JANGAN lanjut, kasih tau Claude persis pesan ini.")
else:
    fixed = content[:found]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(fixed)
    print(f"BERHASIL benerin {path}.")
    print(f"Dipotong di posisi {found} (dari {n} char total).")
    print(f"Baris baru: {fixed.count(chr(10)) + 1}")
