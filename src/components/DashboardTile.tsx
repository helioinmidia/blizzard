interface Props {
  url: string
  title: string
}

export function DashboardTile({ url, title }: Props) {
  return (
    <iframe
      src={url}
      title={title}
      className="h-full w-full border-0 bg-ink-800"
      allow="fullscreen; autoplay"
      referrerPolicy="no-referrer-when-downgrade"
    />
  )
}
