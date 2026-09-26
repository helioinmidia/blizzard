import { AlertTriangle, Cloud, CloudFog, CloudHail, CloudLightning, CloudRain, CloudRainWind, CloudSnow, CloudSun, Moon, Sun, Wind, type LucideIcon } from 'lucide-react'

/** Ícone por condição do Home Assistant (estado das entidades weather.*). */
export const conditionIcons: Record<string, LucideIcon> = {
  'clear-night': Moon,
  cloudy: Cloud,
  exceptional: AlertTriangle,
  fog: CloudFog,
  hail: CloudHail,
  lightning: CloudLightning,
  'lightning-rainy': CloudLightning,
  partlycloudy: CloudSun,
  pouring: CloudRainWind,
  rainy: CloudRain,
  snowy: CloudSnow,
  'snowy-rainy': CloudSnow,
  sunny: Sun,
  windy: Wind,
  'windy-variant': Wind,
}
