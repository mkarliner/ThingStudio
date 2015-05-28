Router.configure({
	loadingTemplate: 'Loading',
});

AccountsTemplates.configureRoute('signIn');

Router.route("/logout", function(){
	AccountsTemplates.logout();
});
