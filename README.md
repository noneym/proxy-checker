# Proxy Checker

Electron tabanlı masaüstü uygulaması. Proxy listesindeki her proxy üzerinden çıkış IP'sini tespit eder ve [getipintel.net](https://getipintel.net) API'si ile VPN/Proxy skorunu sorgular.

## Özellikler

- SOCKS5 / SOCKS4 / HTTP / HTTPS proxy desteği
- Proxy üzerinden gerçek çıkış IP tespiti (api.ipify.org / ifconfig.me / icanhazip) + **latency ms** ölçümü
- IP zenginleştirme: ülke, şehir, ISP, AS, proxy/hosting/mobile flag'leri (ip-api.com)
- **İki ücretsiz scorer** — en yüksek skor kazanır:
  - **getipintel.net + `oflags=r`** (sadece email) — `ResidentialProxy` probability. residential proxy detection için primary scorer
  - **AbuseIPDB** (1k/gün ücretsiz, opsiyonel) — abuseConfidenceScore + 365-günlük rapor geçmişi
- **"Raporu olan IP'leri atla" checkbox** — AbuseIPDB'de rapor olan IP'ler için getipintel atlanır, getipintel'in 15/dk rate limit'i temiz adaylara saklanır
- Eşzamanlı IP tespiti (5 paralel)
- Akıllı throttling: getipintel çağırılırken 4.5s gap, atlanırsa 300ms
- CSV export: tüm sinyaller, latency, residentialProxy %, AbuseIPDB detayları, scoreSources breakdown
- Renkli skor + chip'li tip göstergesi (Proxy/Tor/Hosting/Mobile/Residential Proxy %)

## Kurulum

```bash
npm install
npm start
```

## Kullanım

1. **Contact email** gir — getipintel.net residential proxy detection için. Hesap açmaya gerek yok, sadece email lazım.
2. (Opsiyonel) **AbuseIPDB API key** — https://www.abuseipdb.com/register ücretsiz signup, abuse rapor geçmişi sinyali
3. (Opsiyonel) **"Raporu olan IP'leri atla"** checkbox'ı işaretle — büyük listede getipintel rate limit'i temiz adaylar için saklanır
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

Ek olarak şu sinyaller tek başlarına da kırmızı VPN/Proxy etiketi tetikler: ip-api `proxy=true`, AbuseIPDB `isTor=true`, getipintel `ResidentialProxy ≥ 30%`.

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
| AbuseIPDB | Ücretsiz (1k/gün, signup) | Spam/bot/scan rapor geçmişi (365 gün) |
| ip-api | Ücretsiz (45/dk) | Proxy/hosting/mobile boolean'ları |
| Latency | Ücretsiz | Yavaş proxy = burned/aşırı kullanılan |

## Notlar

- getipintel.net free tier: günde 500, dakikada 15 istek limiti.
- ip-api.com free: 45 istek/dakika, anahtar gerektirmez (HTTP).
- AbuseIPDB free: 1000 istek/gün, email signup.
- Uygulama proxy üzerinden 15 saniye timeout kullanır; ölü proxyler otomatik atlanır.
- "Raporu olan IP'leri atla" işaretliyse: AbuseIPDB'de rapor olan IP'ler için getipintel çağrılmaz, doğrudan "Atlandı (raporlu)" badge'i atanır. Büyük listelerde getipintel rate limit'ini korur ve toplam süreyi düşürür.
