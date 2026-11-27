import { createRoot } from 'react-dom/client'
import '@fontsource/eb-garamond/400.css'
import '@fontsource/eb-garamond/400-italic.css'
import '@fontsource/eb-garamond/700.css'
import '@fontsource/eb-garamond/700-italic.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import './styles/app.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
