import { useMemo } from 'react';
import { notifySuccess, notifyError, notifyInfo, notifyWarning } from '../utils/messageBus';

const useNotify = () => {
  return useMemo(
    () => ({
      success: notifySuccess,
      error: notifyError,
      info: notifyInfo,
      warning: notifyWarning,
    }),
    [],
  );
};

export default useNotify;
