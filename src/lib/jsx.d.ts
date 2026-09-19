import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'blizzard-video': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}
