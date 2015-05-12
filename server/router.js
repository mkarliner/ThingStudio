Router.route('/home', {where: 'server'}).get(function() {
  this.response.writeHead(302, {
    'Location': "http://www.thingstud.io/index.html"
  });
  this.response.end();
});