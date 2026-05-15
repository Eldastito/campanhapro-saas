import * as React from 'react';

// Função auxiliar para obter e analisar o valor do localStorage com segurança.
function getStoredValue<T>(key: string, initialValue: T): T {
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : initialValue;
  } catch (error) {
    console.error(`Erro ao ler a chave do localStorage “${key}”:`, error);
    return initialValue;
  }
}

/**
 * Um hook customizado para persistir o estado no localStorage do navegador.
 * @param key A chave para usar no localStorage.
 * @param initialValue O valor inicial a ser usado se não houver nada no localStorage.
 * @returns Uma tupla contendo o valor do estado e uma função para atualizá-lo, similar ao useState.
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  // O estado é inicializado com o valor do localStorage ou o valor inicial.
  const [storedValue, setStoredValue] = React.useState<T>(() => {
    return getStoredValue(key, initialValue);
  });

  // A função setValue atualiza o estado e persiste o novo valor no localStorage.
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      // Usamos a forma funcional do 'setState' para garantir que sempre tenhamos o estado mais recente.
      setStoredValue(currentState => {
        // Permite que o novo valor seja um valor direto ou uma função, como no useState.
        const valueToStore = value instanceof Function ? value(currentState) : value;
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
        return valueToStore;
      });
    } catch (error) {
      console.error(`Erro ao definir a chave do localStorage “${key}”:`, error);
    }
  };

  return [storedValue, setValue];
}
