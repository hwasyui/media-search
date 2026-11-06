import pkg from 'google-news-url-decoder';
const { GoogleDecoder } = pkg;

async function test() {
  const decoder = new GoogleDecoder();
  const link = 'https://news.google.com/rss/articles/CBMifEFVX3lxTFA5eS01MHh3djcxZHNXYXFhTElxcUdBdkR3VkJpTXlFcTctNmxjbmZpOHZ1aW82Nl9oMV9qdk1pOUJ3a0w5ZzRkWm1JNm81YmN5OUl0SGtrLXlqN2t0cWhwX1E0SFdYUXlvdnExUzhvR1RtbTVGMDc3eHdBV3Y1d1E';
  try {
    const res = await decoder.decodeUrl(link);
    console.log('Node decoder result:', res);
  } catch (e) {
    console.log('Node decoder error:', e.message);
  }
}
test();

