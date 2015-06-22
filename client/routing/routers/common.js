
Router.plugin('ensureSignedIn', {
	except: ["ViewApp", "ViewScreen"]
});

Router.configure({
	loadingTemplate: 'Loading',
});

AccountsTemplates.configureRoute('signIn', {
	// template: "TSLogin",
	redirect: "/screens"
});

// AccountsTemplates.configureRoute('ensureSignedIn', {
//     template: 'myLogin',
//     layoutTemplate: 'myLayout',
// });

Router.route("/", function(){
	this.redirect("/dashboard")
})

Router.route("/logout", function(){
	AccountsTemplates.logout();
});
