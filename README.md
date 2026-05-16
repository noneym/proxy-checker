# Proxy Checker

Electron tabanlı masaüstü uygulaması. Proxy listesindeki her proxy üzerinden çıkış IP'sini tespit eder ve [getipintel.net](https://getipintel.net) API'si ile VPN/Proxy skorunu sorgular.

## Özellikler

- SOCKS5 / SOCKS4 / HTTP / HTTPS proxy desteği
- Proxy üzerinden gerçek çıkış IP tespiti (api.ipify.org / ifconfig.me / icanhazip) + **latency ms** ölçümü
- IP zenginleştirme: ülke, şehir, ISP, AS, proxy/hosting/mobile flag'leri (ip-api.com)
- **Çoklu scorer desteği** — en yüksek skoru gösterir:
  - **getipintel.net + `oflags=r`** (ücretsiz, sadece email) — combined score + `ResidentialProxy` probability. residential proxy detection için **bu uygulamanın primary scorer'ı**
  - **AbuseIPDB** (önerilen ek sinyal, 1k/gün ücretsiz) — abuseConfidenceScore + 365-günlük rapor geçmişi
  - **IPQualityScore** (paid plan) — opsiyonel, varsa fraud_score
- Eşzamanlı IP tespiti (5 paralel)
- Akıllı throttling: getipintel için 4.5s (15/dk limiti), AbuseIPDB/IPQS için 300ms
- CSV export: tüm sinyaller, latency, residentialProxy %, AbuseIPDB detayları, scoreSources breakdown
- Renkli skor + chip'li tip göstergesi (Proxy/VPN/Tor/Abuse/Hosting/Mobile/Residential Proxy %)

## Kurulum

```bash
npm install
npm start
```

## Kullanım

1. **Contact email** gir (zorunlu önerilen) — getipintel.net'in residential proxy detection'ı için. Hesap açmaya gerek yok, sadece email lazım.
2. (Opsiyonel) **AbuseIPDB API key** — https://www.abuseipdb.com/register ücretsiz signup, abuse rapor geçmişi sinyali
3. (Opsiyonel) **IPQualityScore API key** — paid plan
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

## getipintel `oflags=r` notu

getipintel.net'in `oflags=r` parametresi olmadan residential proxy detection sinyali **kapalı** — gonzoproxy/brightdata gibi servisler için varsayılan modda `0` döner. Doğru endpoint:

```
https://check.getipintel.net/check.php?ip=X&contact=Y&format=json&oflags=r
```

Cevapta iki alan döner:
- `result`: combined score (badIP + VPN + residential, 0-1)
- `ResidentialProxy`: sadece residential proxy probability (0-1)

Uygulama bunu otomatik kullanıyor.

## Skor sinyalleri özet

| Sinyal | Maliyet | Ne yakalar |
|---|---|---|
| getipintel + oflags=r | Ücretsiz (email) | Residential proxy + VPN + blacklist (combined) |
| AbuseIPDB | Ücretsiz (1k/gün, signup) | Spam/bot/scan rapor geçmişi |
| ip-api | Ücretsiz (45/dk) | Proxy/hosting/mobile boolean'ları |
| Latency | Ücretsiz | Yavaş proxy = burned/aşırı kullanılan |
| IPQualityScore | Paid | ML-based residential ağı tanıma |

## Notlar

- getipintel.net free tier: günde 500, dakikada 15 istek limiti vardır.
- ip-api.com free: 45 istek/dakika, anahtar gerektirmez (HTTP).
- IPQualityScore free: 5000 istek/ay, signup gerektirir.
- Uygulama proxy üzerinden 15 saniye timeout kullanır; ölü proxyler otomatik atlanır.
