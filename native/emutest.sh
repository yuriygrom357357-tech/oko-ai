#!/usr/bin/env bash
# Самоперевірка ОКО-ШІ на емуляторі Android справжніми натисками (adb input tap):
# запуск → кнопка «Демо: піхота» → чекаємо виявлень → «Стоп» → «Статистика» → перевіряємо фото.
set -u
APK="$1"; PKG=ua.okoai.app
adb install -r -g "$APK" || { echo "::error::Емулятор: APK не встановився"; exit 0; }
adb logcat -c
adb shell am start -n $PKG/.MainActivity
last() { adb logcat -d | grep -o "$1 {.*}" | tail -1 | sed "s/^$1 //"; }
jq_() { python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))" "$1" "$2" 2>/dev/null; }
# 1) чекаємо готовності ШІ
for i in $(seq 1 90); do sleep 4; E=$(last OKO_EL); [ -n "$E" ] && [ "$(jq_ "$E" "d['ready']")" = "True" ] && break; done
E=$(last OKO_EL); echo "::notice::Готовність: $E" | cut -c1-400
[ "$(jq_ "$E" "d['ready']")" = "True" ] || { echo "::error::ШІ не завантажився за 6 хв"; adb logcat -d | grep -i -E "Console|chromium" | tail -8 | sed 's/^/::warning::/'; exit 0; }
# калібрування: де WebView на екрані
SZ=$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1); W=${SZ%x*}; H=${SZ#*x}
adb shell input tap $((W/2)) $((H/2)); sleep 2
TC=$(last OKO_TOUCH); DPR=$(jq_ "$TC" "d['dpr']")
OX=$(python3 -c "print(int($W/2 - $(jq_ "$TC" "d['x']")*$DPR))"); OY=$(python3 -c "print(int($H/2 - $(jq_ "$TC" "d['y']")*$DPR))")
echo "::notice::Екран ${W}x${H}, dpr=$DPR, зсув WebView $OX,$OY"
tap() { local E X Y i; for i in 1 2 3 4 5 6; do E=$(last OKO_EL); X=$(jq_ "$E" "d['el']['$1'][0]"); Y=$(jq_ "$E" "d['el']['$1'][1]"); [ -n "$X" ] && break; sleep 3; done
  [ -z "$X" ] && { echo "::error::Кнопку $1 не видно на екрані: $(echo "$E" | cut -c1-300)"; return 1; }
  adb shell input tap $(python3 -c "print(int($X*$DPR+$OX), int($Y*$DPR+$OY))"); echo "::notice::Натиснуто $1"; }
tap btnDemoInf
# емулятор без відеокарти рахує повільно — чекаємо перших виявлень до 4 хв
for i in $(seq 1 48); do sleep 5; R=$(last OKO_RESULT); [ -n "$R" ] && [ "$(jq_ "$R" "d['log']>0")" = "True" ] && break; done
sleep 6; R=$(last OKO_RESULT); echo "::notice::Аналіз: $R"
tap btnStop; sleep 3
tap btnStats; sleep 4
S=$(last OKO_STATS); echo "::notice::Статистика: $S"
tap stClose; sleep 2
adb exec-out screencap -p > emu-screen.png 2>/dev/null || true
INF=$(jq_ "$R" "d['inf']+d['log']"); PH=$(jq_ "$S" "d['photos']")
if [ "${INF:-0}" -gt 0 ] && [ "${PH:-0}" -gt 0 ]; then touch "$GITHUB_WORKSPACE/emu-ok"; echo "::notice::Перевірку пройдено: піхоту виявлено, фото у статистиці є";
else echo "::error::Перевірка не пройдена (виявлення: ${INF:-0}, фото: ${PH:-0})"; adb logcat -d | grep -i -E "Capacitor/Console.*(error|fail)|Uncaught" | tail -6 | cut -c1-300 | sed 's/^/::warning::/'; fi
exit 0
