import { notifySuccess, notifyError, notifyInfo, notifyWarning } from '../utils/messageBus';

const useNotify = () => {
  return {
    success: notifySuccess,
    error: notifyError,
    info: notifyInfo,
    warning: notifyWarning,
  };
};

export default useNotify;
