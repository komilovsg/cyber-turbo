# Cyber Turbo 3D

Неоновая гонка по ночному шоссе на three.js. Работает как PWA: устанавливается на телефон и компьютер, открывается во весь экран и играется без интернета.

## Быстрый старт (локально)

Нужен Node.js 18 или новее.

```bash
npm install
npm start
```

Открой http://localhost:5173. Команда `npm start` сначала обновляет список файлов в `sw.js` (`npm run sw`), а потом запускает локальный сервер.

Открывать `index.html` двойным кликом нельзя. ES-модули и service worker работают только через сервер (`http://localhost` или `https://`).

### Проверка на телефоне в той же Wi-Fi сети

`serve` печатает адрес вида `http://192.168.x.x:5173`, и его можно открыть на телефоне. Игра там запустится, но установка и офлайн-режим работать не будут: браузеры разрешают service worker только по HTTPS или на localhost. Чтобы проверить установку, задеплой проект (см. ниже).

## Управление

| | Клавиатура | Телефон |
|---|---|---|
| Руль | ← → или A D | кнопки слева; в гараже можно включить руление наклоном телефона («Steering: tilt») |
| Газ / тормоз | ↑ ↓ или W S | кнопки справа |
| Нитро | Space или Shift | кнопка с молнией (газ жать не нужно) |
| Гудок | H | кнопка с рупором (ближайшая машина впереди в твоей полосе перестроится) |
| Дальний свет | L | кнопка с лучами (тот же эффект, плюс вспышка фар) |
| Поворотники | Q (левый) / E (правый) | две янтарные кнопки со стрелками (повтор — выключить; гаснут сами после смены полосы) |
| Зеркало заднего вида | кнопка в HUD (рядом с паузой) или «Mirror» в гараже | кнопка в HUD |
| Оглянуться | C (удерживать) | кнопка с глазом (удерживать) |
| Пауза | P или Esc | кнопка паузы |

## Загрузка на GitHub

```bash
git init
git add .
git commit -m "Cyber Turbo 3D PWA"
git branch -M main
git remote add origin https://github.com/<твой-логин>/cyber-turbo.git
git push -u origin main
```

## Публикация (выбери один вариант)

### Вариант A: GitHub Pages (бесплатно, автоматически)

1. В репозитории открой Settings → Pages.
2. В Source выбери **GitHub Actions**.
3. Сделай любой push в `main`. Workflow из `.github/workflows/deploy.yml` сам обновит `sw.js` и опубликует игру.

Адрес будет вида `https://<логин>.github.io/cyber-turbo/`. Все пути в проекте относительные, поэтому подпапка работает.

### Вариант B: Vercel

Import Project → выбери репозиторий → Framework Preset: **Other**. Build Command оставь пустым, Output Directory поставь `.`. Заголовки для `sw.js` уже лежат в `vercel.json`.

С Vercel перед каждым коммитом запускай `npm run sw`, иначе игроки не получат обновление. В варианте A это делается автоматически.

## Установка игроками

- **Android (Chrome, Edge, Samsung Internet):** кнопка «Install app» в гараже или пункт меню «Установить приложение».
- **iPhone / iPad (Safari):** «Поделиться» → «На экран Домой». Кнопка «Install app» в игре показывает эту подсказку.
- **Windows / macOS / Linux (Chrome, Edge):** значок установки в адресной строке или кнопка «Install app».

После первого открытия игра сохраняется в кэш и дальше работает офлайн.

## Обновления

При изменении любого файла `npm run sw` вычисляет новый хэш версии. У игроков с открытой игрой появится плашка «A new version is ready → Reload». Остальные получат новую версию при следующем запуске.

## Структура

```
index.html             разметка и importmap
css/style.css          стили, шрифты
js/game.js             игра (three.js, физика, звук, HUD)
js/pwa.js              установка, service worker, плашка обновления
sw.js                  офлайн-кэш (блок <generated> создаёт скрипт)
manifest.webmanifest   имя, иконки, режим fullscreen
icons/                 иконки и скриншоты для окна установки
fonts/                 Chakra Petch (SIL OFL)
vendor/three/          three.js r170 и нужные addons, GLTFLoader, meshopt-декодер (MIT)
models/                3D-модели машин (GLB, meshopt + webp)
scripts/build-sw.mjs   генератор списка файлов для sw.js
```

Сборщик не нужен: всё работает как статические файлы, без интернета и CDN.

## Лицензии

three.js распространяется под MIT (`vendor/three/LICENSE`), шрифт Chakra Petch под SIL Open Font License (`fonts/OFL.txt`).

## Credits

3D car models (converted to GLB, compressed with meshopt and WebP textures). CC-BY 4.0: https://creativecommons.org/licenses/by/4.0/

- Chevrolet Camaro by PuKkBuMXDD, CC-BY 4.0, [source](https://poly.pizza/m/kVcKsd2dEk)
- Lamborghini Aventador by Ignition Labs, CC-BY 4.0, [source](https://poly.pizza/m/5zUWP5UsLg-)
- Mazda RX-7 by IvOfficial, CC-BY 4.0, [source](https://poly.pizza/m/SnIoWlh7S2)
- Dodge Charger by David Sirera, CC-BY 4.0, [source](https://poly.pizza/m/4b80hRVxqvv)
- Cesium Milk Truck by Cesium, CC-BY 4.0, [source](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CesiumMilkTruck)
- Pickup Truck by Quaternius, CC0, [source](https://poly.pizza/m/qn4grQgHm8)
- Car (sedan) by Quaternius, CC0, [source](https://poly.pizza/m/Cz6yDaUcM9)
- Car (sedan 2) by Quaternius, CC0, [source](https://poly.pizza/m/unqqkULtRU)
- SUV by Quaternius, CC0, [source](https://poly.pizza/m/xsMtZhBkxL)
- Police Car by Quaternius, CC0, [source](https://poly.pizza/m/BwwnUrWGmV)
- Car Hatchback by Kay Lousberg, CC0, [source](https://poly.pizza/m/BG0KAhmGDt)
- three.js, MIT, https://threejs.org
