# Proxy Checker

Electron tabanlı masaüstü uygulaması. Proxy listesindeki her proxy üzerinden çıkış IP'sini tespit eder ve [getipintel.net](https://getipintel.net) API'si ile VPN/Proxy skorunu sorgular.

## Özellikler

- SOCKS5 / SOCKS4 / HTTP / HTTPS proxy desteği
- Proxy üzerinden gerçek çıkış IP tespiti (api.ipify.org / ifconfig.me / icanhazip) + **latency ms** ölçümü
- IP zenginleştirme: ülke, şehir, ISP, AS, proxy/hosting/mobile flag'leri (ip-api.com)
- **Çoklu scorer desteği** — en yüksek skoru gösterir:
  - **AbuseIPDB** (önerilen, gerçekten ücretsiz: 1k/gün, sadece email signup) — abuseConfidenceScore + rapor sayısı + son raporlanma tarihi
  - **IPQualityScore** (paid plan gerekiyor) — fraud_score + proxy/vpn/tor/active_vpn/recent_abuse flag'leri
  - **getipintel.net** (email ile ücretsiz, residential'larda 0 dönebilir)
- Eşzamanlı IP tespiti (5 paralel)
- Akıllı throttling: getipintel için 4.5s, IPQS/AbuseIPDB için 300ms
- IPQS account-level hatalarda batch durmaz, AbuseIPDB ile devam eder
- CSV export: tüm sinyaller, latency, AbuseIPDB detayları, scoreSources breakdown
- Renkli skor + chip'li tip göstergesi (Proxy/VPN/Tor/Abuse/Hosting/Mobile/Residential + abuse rapor sayısı)

## Kurulum

```bash
npm install
npm start
```

## Kullanım

1. **AbuseIPDB API key** al (önerilen): https://www.abuseipdb.com/register — 1000/gün ücretsiz, sadece email signup. Burned residential proxy'leri yakalar.
2. (Opsiyonel) **IPQualityScore API key** — paid plan, residential detection için en iyi
3. (Opsiyonel) **Contact email** — getipintel için
4. Proxy listesini yapıştır. Her satıra bir proxy. Format örnekleri:
   ```
   socks5://kullanici:sifre@host.example.com:10000
   http://kullanici:sifre@host.example.com:8080
   socks5://host.example.com:1080
   ```
5. **Kontrol Et**'e bas.
6. Sonuçları **CSV Olarak Dışa Aktar** ile kaydet.

## Skor Yorumlama (0-100)

| Skor | Anlam |
|---|---|
| < 50 | Temiz |
| 50 – 84 | Şüpheli |
| ≥ 85 | VPN / Proxy / Tor olarak işaretli |

Ek olarak şu flag'ler tek başlarına da kırmızı VPN/Proxy etiketi tetikler: `proxy`, `vpn`, `tor`, `active_vpn`, `recent_abuse`.

## Residential proxy detection neden zor?

Residential proxy servisleri (gonzoproxy, brightdata, oxylabs vb.) gerçek konut IP'leri (Sky, Comcast, Vodafone müşteri bağlantıları) kullanır. Bu IP'ler tipik olarak:
- getipintel: 0
- proxycheck.io (anahtarsız): risk 0
- ip-api: proxy=false
- Spamhaus / DNSBL'ler: temiz

Çünkü asıl IP **gerçek bir konut bağlantısı**. Tek pratik sinyaller:
1. **AbuseIPDB** — IP daha önce abuse edilmiş mi (residential proxy'ler "burned" olunca raporlanır)
2. **IPQualityScore** (paid) — davranışsal/ML temelli detection, residential proxy ağlarını ML ile tanıyor
3. **Latency** — yavaş proxy = aşırı kullanılan/burned proxy

Bu uygulama 1+3'ü ücretsiz veriyor; 2 paid hesap gerektiriyor.

## Notlar

- getipintel.net free tier: günde 500, dakikada 15 istek limiti vardır.
- ip-api.com free: 45 istek/dakika, anahtar gerektirmez (HTTP).
- IPQualityScore free: 5000 istek/ay, signup gerektirir.
- Uygulama proxy üzerinden 15 saniye timeout kullanır; ölü proxyler otomatik atlanır.
