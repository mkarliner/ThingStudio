Router.configure({
	loadingTemplate: 'Loading',
	controller: 'IDEController'
});

AccountsTemplates.configureRoute('signIn');

Router.route("/logout", function(){
	AccountsTemplates.logout();
});
