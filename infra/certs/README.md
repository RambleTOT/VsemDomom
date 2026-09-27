# Сертификаты Минцифры

Публичные корневой и промежуточный сертификаты «Russian Trusted» (источник — https://www.gosuslugi.ru/crt, файлы с gu-st.ru). Они попадают в образ (`update-ca-certificates`, `NODE_EXTRA_CA_CERTS`), чтобы api и worker доверяли TLS-сертификату `platform-api2.max.ru`: документация MAX требует добавить сертификат Минцифры в доверенные.

| Файл | Субъект | SHA-256 | Действует до |
|---|---|---|---|
| `russian_trusted_root_ca.crt` | Russian Trusted Root CA | `D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31` | 27.02.2032 |
| `russian_trusted_sub_ca.crt` | Russian Trusted Sub CA (2022) | `BB:BD:E2:10:3E:79:0B:99:9E:C6:2B:D0:3C:F6:25:A5:A2:E7:C3:16:E1:0A:FE:6A:49:0E:ED:EA:D8:B3:FD:9B` | 06.03.2027 |

Проверено 27.09.2026: цепочка `platform-api2.max.ru` (промежуточный Russian Trusted Sub CA 2024–2029 присылает сам сервер) проверяется этим корневым сертификатом — `openssl verify -CAfile russian_trusted_root_ca.crt -untrusted <промежуточный> <сертификат сервера>` → OK.

Проверить отпечатки самостоятельно:

```bash
openssl x509 -in infra/certs/russian_trusted_root_ca.crt -noout -fingerprint -sha256
```
