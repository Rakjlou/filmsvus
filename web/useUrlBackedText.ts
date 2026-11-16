import { useState } from 'react';

export function useUrlBackedText(urlValue: string, push: (value: string) => void) {
  const [text, setText] = useState(urlValue);
  const [previousUrlValue, setPreviousUrlValue] = useState(urlValue);
  // Urgent input renders still see the old URL; only a changed URL resets the text.
  if (urlValue !== previousUrlValue) {
    setPreviousUrlValue(urlValue);
    setText(urlValue);
  }
  const changeText = (value: string) => {
    setText(value);
    push(value);
  };
  return [text, changeText] as const;
}
