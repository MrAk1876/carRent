import React, { useEffect, useMemo, useState } from 'react';

const TypingText = ({
  words = [],
  typingSpeed = 70,
  deletingSpeed = 45,
  pauseMs = 1200,
  className = '',
}) => {
  const safeWords = useMemo(() => {
    return Array.isArray(words) && words.length > 0 ? words : [''];
  }, [words]);
  const [wordIndex, setWordIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentWord = safeWords[wordIndex];
    const doneTyping = typed === currentWord;
    const doneDeleting = typed.length === 0;

    let timeout;

    if (doneTyping && !isDeleting) {
      timeout = setTimeout(() => setIsDeleting(true), pauseMs);
    } else if (doneDeleting && isDeleting) {
      setIsDeleting(false);
      setWordIndex((prev) => (prev + 1) % safeWords.length);
    } else {
      timeout = setTimeout(
        () => {
          setTyped((prev) =>
            isDeleting ? currentWord.slice(0, Math.max(prev.length - 1, 0)) : currentWord.slice(0, prev.length + 1)
          );
        },
        isDeleting ? deletingSpeed : typingSpeed
      );
    }

    return () => clearTimeout(timeout);
  }, [typed, isDeleting, wordIndex, safeWords, typingSpeed, deletingSpeed, pauseMs]);

  return (
    <span className={className}>
      {typed}
      <span className="animate-pulse">|</span>
    </span>
  );
};

export default TypingText;
