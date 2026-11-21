#!/usr/bin/env bash
# Самоперевірка ОКО-ШІ на емуляторі Android справжніми натисками (adb input tap).
# 1) ШІ на кадрі з піхотою  2) кнопки: Статистика, Закрити, перемикач ПІХОТА  3) відео-демо (інформативно:
# емулятор без відеокарти часто не декодує відео — на справжніх телефонах воно працює).
set -u
APK="$1"; PKG=ua.okoai.app
adb install -r -g "$APK" || { echo "::error::Емулятор: APK не встановився"; exit 0; }
adb logcat -c
adb shell am start -n $PKG/.MainActivity
last() { adb logcat -d | grep -o "$1 {.*}" | tail -1 | sed "s/^$1 //"; }
jq_() { python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))" "$1" "$2" 2>/dev/null; }
for i in $(seq 1 90); do sleep 4; E=$(last OKO_EL); [ -n "$E" ] && [ "$(jq_ "$E" "d['ready'] and d['w']>0")" = "True" ] && break; done
E=$(last OKO_EL); echo "::notice::Готовність: $(echo "$E" | cut -c1-300)"
[ "$(jq_ "$E" "d['ready']")" = "True" ] || { echo "::error::ШІ не завантажився за 6 хв"; exit 0; }
for i in $(seq 1 30); do sleep 3; ST=$(last OKO_STILL); [ -n "$ST" ] && break; done
echo "::notice::ШІ на кадрі з піхотою: $ST"
SZ=$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1); W=${SZ%x*}; H=${SZ#*x}
adb shell input keyevent 82; adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1
TC=""; for i in 1 2 3 4 5 6; do adb shell am start -n $PKG/.MainActivity >/dev/null 2>&1; sleep 1; adb shell input tap $((W/2)) $((H/2)); sleep 2; TC=$(last OKO_TOUCH); [ -n "$TC" ] && break; adb shell input keyevent 4; adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1; sleep 2; done
if [ -n "$TC" ]; then DPR=$(jq_ "$TC" "d['dpr']")
  OX=$(python3 -c "print(int($W/2 - $(jq_ "$TC" "d['x']")*$DPR))"); OY=$(python3 -c "print(int($H/2 - $(jq_ "$TC" "d['y']")*$DPR))")
else DEN=$(adb shell wm density | grep -o '[0-9]*' | tail -1); DPR=$(python3 -c "print(${DEN:-160}/160)"); OX=0; OY=$(python3 -c "print(int(24*$DPR))"); echo "::warning::Калібрування дотиком не вдалося, беру щільність екрана"; fi
echo "::notice::Екран ${W}x${H}, dpr=$DPR, зсув WebView $OX,$OY"
tap() { local E X Y i; for i in 1 2 3 4 5 6; do E=$(last OKO_EL); X=$(jq_ "$E" "d['el']['$1'][0]"); Y=$(jq_ "$E" "d['el']['$1'][1]"); [ -n "$X" ] && break; sleep 3; done
  [ -z "$X" ] && { echo "::error::Кнопку $1 не видно: $(echo "$E" | cut -c1-200)"; return 1; }
  adb shell input tap $(python3 -c "print(int($X*$DPR+$OX), int($Y*$DPR+$OY))"); echo "::notice::Натиснуто $1"; }
OK=0
sleep 3; tap btnStats; sleep 4; E=$(last OKO_EL); [ "$(jq_ "$E" "d['so']")" = "True" ] && { OK=$((OK+1)); echo "::notice::Статистика відкрилась"; }
tap stClose; sleep 3; E=$(last OKO_EL); [ "$(jq_ "$E" "d['so']")" = "False" ] && { OK=$((OK+1)); echo "::notice::Статистика закрилась"; }
tap tgInf; sleep 3; E=$(last OKO_EL); [ "$(jq_ "$E" "d['tg']")" = "False" ] && { OK=$((OK+1)); echo "::notice::Перемикач ПІХОТА вимкнувся"; }
tap tgInf; sleep 3; E=$(last OKO_EL); [ "$(jq_ "$E" "d['tg']")" = "True" ] && { OK=$((OK+1)); echo "::notice::Перемикач ПІХОТА увімкнувся"; }
adb exec-out screencap -p > emu-screen.png 2>/dev/null || true
tap btnDemoInf; sleep 45; R=$(last OKO_RESULT); echo "::notice::Відео-демо (інформативно): $R"
SI=$(jq_ "$ST" "d.get('inf',0)")
if [ "${SI:-0}" -gt 0 ] && [ "$OK" -eq 4 ]; then touch "$GITHUB_WORKSPACE/emu-ok"; echo "::notice::Перевірку пройдено: ШІ знайшов піхоту ($SI), кнопки 4/4";
else echo "::error::Перевірка не пройдена: ШІ піхота=$SI, кнопки $OK/4"; fi
exit 0
