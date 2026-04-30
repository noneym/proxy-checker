# Proxy Checker

Electron tabanlı masaüstü uygulaması. Proxy listesindeki her proxy üzerinden çıkış IP'sini tespit eder ve [getipintel.net](https://getipintel.net) API'si ile VPN/Proxy skorunu sorgular.

## Özellikler

- SOCKS5 / SOCKS4 / HTTP / HTTPS proxy desteği
- Proxy üzerinden gerçek çıkış IP tespiti (api.ipify.org / ifconfig.me / icanhazip)
- IP zenginleştirme: ülke, şehir, ISP (ipinfo.io)
- getipintel.net üzerinden VPN/Proxy skoru (0-1, 1'e yakın = proxy/VPN ihtimali yüksek)
- Eşzamanlı IP tespiti (5 paralel)
- getipintel free tier rate limit'ine uygun throttling (15 istek/dakika)
- CSV olarak dışa aktarma
- Renkli skor görüntüleme

## Kurulum

```bash
npm install
npm start
```

## Kullanım

1. Üst sağdaki **Contact email** alanına geçerli bir e-posta gir (getipintel API için zorunlu).
2. Proxy listesini yapıştır. Her satıra bir proxy. Format örnekleri:
   ```
   socks5://kullanici:sifre@host.example.com:10000
   http://kullanici:sifre@host.example.com:8080
   socks5://host.example.com:1080
   ```
3. **Kontrol Et**'e bas.
4. Sonuçları **CSV Olarak Dışa Aktar** ile kaydet.

## Skor Yorumlama

| Skor | Anlam |
|---|---|
| < 0.5 | Temiz (residential / datacenter olmayan) |
| 0.5 – 0.9 | Şüpheli |
| > 0.9 | VPN / Proxy / Tor olarak işaretli |

## Notlar

- getipintel.net free tier: günde 500, dakikada 15 istek limiti vardır.
- Uygulama proxy üzerinden 15 saniye timeout kullanır; ölü proxyler otomatik atlanır.
