# Капля

Кинематографичный 3D-сайт: непрерывный зум от капли росы (1 мм) до планеты (12 742 км) по скроллу.

**Статус:** в разработке. Готова сцена I («Капля»), интерфейс (счётчик масштаба, линейка, навигация, подписи, прелоадер) и постобработка. Сцены II–VI будут добавлены следом.

## Запуск локально

```bash
python3 -m http.server 8000
# открыть http://localhost:8000
```

## Стек

- [Three.js](https://threejs.org) — 3D и шейдеры (лежит в `vendor/`, без сборки)
- [Lenis](https://github.com/darkroomengineering/lenis) — плавный скролл
- Всё процедурное: без текстур и моделей

## Публикация

Сайт: **https://accauntov5-ai.github.io/**

Settings → Pages → Build and deployment → Source: *Deploy from a branch* → ветка с сайтом, папка `/ (root)`.
