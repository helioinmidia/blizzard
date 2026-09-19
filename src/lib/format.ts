const timeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })

export function formatClock(date: Date): string {
  return timeFormatter.format(date)
}

export function formatShortDate(date: Date): string {
  return dateFormatter.format(date).replace('.', '')
}
