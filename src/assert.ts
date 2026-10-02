export default function assert(condition: any, message = '') {
  if (!condition) {
    const error = new Error();
    error.message = message;
    throw error;
  }
}
