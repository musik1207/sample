"""追加の問題（ID なし）を資格の問題ファイルに統合する。

使い方: python3 scripts/merge-questions.py <資格ID> <ID 接頭辞> <追加ファイル.json>
追加ファイルの各問題には domain / type / question / choices / answer / explanation を書く。
ID は「<接頭辞>-<範囲の略>-<連番>」で自動採番する。
"""
import json
import sys
from pathlib import Path

cert_id, prefix, add_path = sys.argv[1], sys.argv[2], sys.argv[3]
root = Path(__file__).resolve().parent.parent
q_path = root / 'src/data/questions' / f'{cert_id}.json'
certs = json.loads((root / 'src/data/certs.json').read_text())['certs']
domains = [d['id'] for d in next(c for c in certs if c['id'] == cert_id)['domains']]

questions = json.loads(q_path.read_text())
existing = {q['id'] for q in questions}
added = json.loads(Path(add_path).read_text())
counters = {}
for q in added:
    d = q['domain']
    if d not in domains:
        sys.exit(f'unknown domain: {d}')
    short = ''.join(w[0] for w in d.split('-'))[:3]
    while True:
        counters[d] = counters.get(d, 0) + 1
        qid = f'{prefix}-{short}-{counters[d]:03d}'
        if qid not in existing:
            break
    existing.add(qid)
    questions.append({'id': qid, **q})

questions.sort(key=lambda q: domains.index(q['domain']))
q_path.write_text(json.dumps(questions, ensure_ascii=False, indent=2) + '\n')
print(f'{cert_id}: +{len(added)} -> {len(questions)}')
