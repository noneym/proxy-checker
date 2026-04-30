# Proxy Checker

Electron tabanlı masaüstü uygulaması. Proxy listesindeki her proxy üzerinden çıkış IP'sini tespit eder ve [getipintel.net](https://getipintel.net) API'si ile VPN/Proxy skorunu sorgular.

## Özellikler

- SOCKS5 / SOCKS4 / HTTP / HTTPS proxy desteği
- Proxy üzerinden gerçek çıkış IP tespiti (api.ipify.org / ifconfig.me / icanhazip)
- IP zenginleştirme: ülke, şehir, ISP, AS, proxy/hosting/mobile flag'leri (ip-api.com)
- **IPQualityScore primary scorer** (5k/ay ücretsiz key ile) — residential proxy detection için tek etkili çözüm. fraud_score 0-100, proxy/vpn/tor/active_vpn/recent_abuse flag'leri
- getipintel.net fallback scorer (key olmayınca; residential proxy'ler için 0 dönme ihtimali yüksek)
- Eşzamanlı IP tespiti (5 paralel)
- Throttling: getipintel için 4.5s gap (15/dk), IPQS için 300ms
- CSV olarak dışa aktarma (tüm flag'ler ve skor sağlayıcısı dahil)
- Renkli skor + chip'li tip göstergesi (Proxy/VPN/Tor/Hosting/Mobile/Residential)

## Kurulum

```bash
npm install
npm start
```

## Kullanım

1. **IPQualityScore API key** al ve gir (önerilen): https://www.ipqualityscore.com/create-account — 5000/ay ücretsiz, residential proxy detection için zorunlu.
2. (Alternatif) **Contact email** gir — IPQS yoksa getipintel kullanılır.
3. Proxy listesini yapıştır. Her satıra bir proxy. Format örnekleri:
   ```
   socks5://kullanici:sifre@host.example.com:10000
   http://kullanici:sifre@host.example.com:8080
   socks5://host.example.com:1080
   ```
4. **Kontrol Et**'e bas.
5. Sonuçları **CSV Olarak Dışa Aktar** ile kaydet.

## Skor Yorumlama (0-100)

| Skor | Anlam |
|---|---|
| < 50 | Temiz |
| 50 – 84 | Şüpheli |
| ≥ 85 | VPN / Proxy / Tor olarak işaretli |

Ek olarak şu flag'ler tek başlarına da kırmızı VPN/Proxy etiketi tetikler: `proxy`, `vpn`, `tor`, `active_vpn`, `recent_abuse`.

## Neden IPQS?

Residential proxy servisleri (gonzoproxy, brightdata, oxylabs vb.) gerçek konut IP'leri kullanır. Bu IP'ler:
- getipintel: skor 0
- proxycheck.io (anahtarsız): risk 0
- ip-api: proxy=false

IPQualityScore davranışsal/ML temelli detection ile bu residential proxy ağlarını yakalayabilir. Anahtarsız serbest API'ler bu seviyede yetersiz kalıyor.

## Notlar

- getipintel.net free tier: günde 500, dakikada 15 istek limiti vardır.
- ip-api.com free: 45 istek/dakika, anahtar gerektirmez (HTTP).
- IPQualityScore free: 5000 istek/ay, signup gerektirir.
- Uygulama proxy üzerinden 15 saniye timeout kullanır; ölü proxyler otomatik atlanır.
