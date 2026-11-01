import type { Components, Theme } from '@mui/material/styles'

export const glassFeedbackComponents = (dark: boolean): Components<Theme> => {
  const surface = dark ? 'rgba(36,43,66,.84)' : 'rgba(245,247,255,.78)'
  const text = dark ? '#edf1ff' : '#263452'
  const edge = dark ? 'rgba(209,221,255,.2)' : 'rgba(255,255,255,.7)'
  const glass = {
    color: text,
    backgroundColor: surface,
    backgroundImage: 'none',
    backdropFilter: 'blur(24px) saturate(135%)',
    border: `1px solid ${edge}`,
    boxShadow: '0 16px 44px rgba(37,51,101,.15)',
  }
  return {
    MuiDialog: {
      styleOverrides: {
        paper: {
          ...glass,
          borderRadius: 22,
          '& .MuiDialogActions-root .MuiButton-root': {
            borderRadius: 12,
            boxShadow: 'none',
            border: `1px solid ${edge}`,
            backgroundImage: 'none',
            backgroundColor: dark
              ? 'rgba(137,158,237,.18)'
              : 'rgba(116,141,234,.14)',
            color: 'inherit',
          },
          '& .MuiDialogActions-root .MuiButton-colorError': {
            color: dark ? '#ffbdc0' : '#994958',
          },
        },
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(33,44,79,.2)',
          backdropFilter: 'blur(5px)',
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          ...glass,
          borderRadius: 14,
          '& .MuiAlert-icon': { opacity: 0.85 },
          '& .MuiAlert-message': { overflowWrap: 'anywhere' },
          '& .MuiAlert-action': { color: 'inherit' },
        },
      },
    },
    MuiSnackbarContent: {
      styleOverrides: { root: { ...glass, borderRadius: 14 } },
    },
  }
}
