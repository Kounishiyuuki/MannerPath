// The reviewed source adapters (ADR-0008). A source that is not listed here cannot be registered or
// approved (REVIEWED_SOURCES is derived from this list), so nothing it ingests can be published:
// adding one is a reviewed repository change together with docs/SOURCES.md.
// OSM is deliberately absent until its own ADR (docs/DATA_POLICY.md).

import type { SourceAdapter } from "./source-adapter.ts";
import { MINATO_ADAPTER } from "./minato-adapter.ts";
import { KOTO_ADAPTER } from "./koto-adapter.ts";
import { KYOTO_ADAPTER } from "./kyoto-adapter.ts";
import { OSAKA_ADAPTER } from "./osaka-adapter.ts";
import { TAITO_ADAPTER } from "./taito-adapter.ts";
import { MUSASHINO_ADAPTER } from "./musashino-adapter.ts";
import { SENDAI_ADAPTER } from "./sendai-adapter.ts";
import { KOMATSU_AIRPORT_ADAPTER } from "./komatsu-airport-adapter.ts";
import { TAKAMATSU_AIRPORT_ADAPTER } from "./takamatsu-airport-adapter.ts";
import { KOCHI_AIRPORT_ADAPTER } from "./kochi-airport-adapter.ts";
import { MATSUYAMA_AIRPORT_ADAPTER } from "./matsuyama-airport-adapter.ts";
import { OITA_AIRPORT_ADAPTER } from "./oita-airport-adapter.ts";
import { YONAGO_AIRPORT_ADAPTER } from "./yonago-airport-adapter.ts";
import { CHUO_PARK_ADAPTER } from "./chuo-park-adapter.ts";
import { CHUO_PRIVATE_ADAPTER } from "./chuo-private-adapter.ts";
import { CHIYODA_ADAPTER } from "./chiyoda-adapter.ts";
import { SHIBUYA_ADAPTER } from "./shibuya-adapter.ts";
import { TOSHIMA_ADAPTER } from "./toshima-adapter.ts";
import { MIYAZAKI_AIRPORT_ADAPTER } from "./miyazaki-airport-adapter.ts";
import { HIROSHIMA_AIRPORT_ADAPTER } from "./hiroshima-airport-adapter.ts";

import { KASSEN_NOMURA_ADAPTER } from "./kassen-nomura-adapter.ts";
import { KANAZAWA_ARTVILLAGE_ADAPTER } from "./kanazawa-artvillage-adapter.ts";

import { KKR_KANAZAWA_ADAPTER } from "./kkr-kanazawa-adapter.ts";
import { MANTEN_KANAZAWA_EKIMAE_ADAPTER } from "./manten-kanazawa-ekimae-adapter.ts";
import { HOTEL_SANRAKU_KANAZAWA_ADAPTER } from "./hotel-sanraku-kanazawa-adapter.ts";
import { ROUTE_INN_KANAZAWA_EKIMAE_ADAPTER } from "./route-inn-kanazawa-ekimae-adapter.ts";
import { HOTEL_VISTA_KANAZAWA_ADAPTER } from "./hotel-vista-kanazawa-adapter.ts";

export const SOURCE_ADAPTERS: readonly SourceAdapter[] = [
  TAITO_ADAPTER, OSAKA_ADAPTER, KOTO_ADAPTER, MUSASHINO_ADAPTER, MINATO_ADAPTER, KYOTO_ADAPTER,
  SENDAI_ADAPTER, KOMATSU_AIRPORT_ADAPTER,
  MATSUYAMA_AIRPORT_ADAPTER, TAKAMATSU_AIRPORT_ADAPTER, OITA_AIRPORT_ADAPTER, KOCHI_AIRPORT_ADAPTER,
  YONAGO_AIRPORT_ADAPTER, MIYAZAKI_AIRPORT_ADAPTER, HIROSHIMA_AIRPORT_ADAPTER,
  CHUO_PARK_ADAPTER, CHUO_PRIVATE_ADAPTER,
  CHIYODA_ADAPTER,
  SHIBUYA_ADAPTER,
  TOSHIMA_ADAPTER,
  KASSEN_NOMURA_ADAPTER, KANAZAWA_ARTVILLAGE_ADAPTER, KKR_KANAZAWA_ADAPTER,
  MANTEN_KANAZAWA_EKIMAE_ADAPTER, HOTEL_SANRAKU_KANAZAWA_ADAPTER, ROUTE_INN_KANAZAWA_EKIMAE_ADAPTER, HOTEL_VISTA_KANAZAWA_ADAPTER,
];
