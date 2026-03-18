module.exports = {
  beforeCreate(event) {
    const { data } = event.params;
    if (data.rating !== null && data.rating !== undefined) {
      data.rating = Math.round(data.rating * 10) / 10;
    }
  },

  beforeUpdate(event) {
    const { data } = event.params;
    if (data.rating !== null && data.rating !== undefined) {
      data.rating = Math.round(data.rating * 10) / 10;
    }
  },
};
